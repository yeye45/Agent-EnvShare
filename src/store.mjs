import fs from 'node:fs';
import path from 'node:path';
import {
  BLOCK_BEGIN,
  BLOCK_END,
  DEFAULT_POLICY_TEMPLATE,
  EXAMPLE_ENV_TEMPLATE,
  ID_REGEX,
  VALID_SCOPES,
  VALID_STATUSES,
  getDefaultSharedRoot,
  getRegistryPaths,
  readUserConfig,
  writeUserConfig,
} from './constants.mjs';

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function normalizePathForCompare(p) {
  if (!p) return '';
  const resolved = path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function atomicWriteFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function withRegistryLock(fn, timeoutMs = 5000) {
  const { registryDir, lockPath } = getRegistryPaths();
  ensureDir(registryDir);
  const start = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
      fs.closeSync(fd);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > 30_000) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timed out acquiring registry lock: ${lockPath}`);
      }
      const waitUntil = Date.now() + 40;
      while (Date.now() < waitUntil) {
        // brief spin wait for cross-process lock release
      }
    }
  }
  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // ignore cleanup error
    }
  }
}

export function initRegistry({ registryDir = null, sharedRoot = null, forcePolicy = false } = {}) {
  if (registryDir) {
    const resolved = path.resolve(registryDir);
    const current = readUserConfig();
    writeUserConfig({
      ...current,
      registry_dir: resolved,
      updated_at: new Date().toISOString(),
    });
  }

  const paths = getRegistryPaths();
  ensureDir(paths.registryDir);
  ensureDir(paths.environmentsDir);

  let policyAction = 'unchanged';
  if (!fs.existsSync(paths.policyPath) || forcePolicy) {
    const template = JSON.parse(fs.readFileSync(DEFAULT_POLICY_TEMPLATE, 'utf8'));
    template.default_shared_root = sharedRoot
      ? path.resolve(sharedRoot)
      : getDefaultSharedRoot();
    atomicWriteFile(paths.policyPath, `${JSON.stringify(template, null, 2)}\n`);
    policyAction = 'created';
  } else if (sharedRoot) {
    const policy = JSON.parse(fs.readFileSync(paths.policyPath, 'utf8'));
    policy.default_shared_root = path.resolve(sharedRoot);
    atomicWriteFile(paths.policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    policyAction = 'updated';
  }

  const tplTarget = path.join(paths.environmentsDir, '_template.json');
  if (!fs.existsSync(tplTarget) && fs.existsSync(EXAMPLE_ENV_TEMPLATE)) {
    fs.copyFileSync(EXAMPLE_ENV_TEMPLATE, tplTarget);
  }

  const policy = loadPolicy();
  const envs = listEnvironments();
  atomicWriteFile(paths.indexMdPath, renderIndexMarkdown(envs, policy));

  return {
    registry_dir: paths.registryDir,
    policy_path: paths.policyPath,
    policy_action: policyAction,
    default_shared_root: policy.default_shared_root,
    index_md: paths.indexMdPath,
    environment_count: envs.length,
  };
}

export function ensureInitialized() {
  const { policyPath } = getRegistryPaths();
  if (!fs.existsSync(policyPath)) {
    initRegistry();
  }
}

export function loadPolicy() {
  const { policyPath } = getRegistryPaths();
  if (!fs.existsSync(policyPath)) {
    initRegistry();
  }
  return JSON.parse(fs.readFileSync(policyPath, 'utf8'));
}

export function savePolicy(policy) {
  const { policyPath } = getRegistryPaths();
  withRegistryLock(() => {
    atomicWriteFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  });
}

export function getEnvFilePath(id) {
  const { environmentsDir } = getRegistryPaths();
  return path.join(environmentsDir, `${id}.json`);
}

export function listEnvironments({ category, status, query } = {}) {
  ensureInitialized();
  const { environmentsDir } = getRegistryPaths();
  ensureDir(environmentsDir);
  const files = fs
    .readdirSync(environmentsDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.json') && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort();

  let envs = files.map((file) => {
    const full = path.join(environmentsDir, file);
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  });

  if (category) {
    const c = category.toLowerCase();
    envs = envs.filter((e) => (e.category || '').toLowerCase() === c);
  }
  if (status) {
    const s = status.toLowerCase();
    envs = envs.filter((e) => (e.status || '').toLowerCase() === s);
  }
  if (query) {
    const q = query.toLowerCase();
    envs = envs.filter((e) => {
      const haystack = [
        e.id,
        e.name,
        e.category,
        e.summary,
        e.root_path,
        e.notes,
        ...(Array.isArray(e.tags) ? e.tags : []),
        ...(Array.isArray(e.how_to_use) ? e.how_to_use : []),
        ...Object.keys(e.executables || {}),
        ...Object.values(e.executables || {}),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  return envs.sort((a, b) => {
    const catCmp = (a.category || '').localeCompare(b.category || '');
    return catCmp !== 0 ? catCmp : (a.id || '').localeCompare(b.id || '');
  });
}

export function getEnvironment(id) {
  ensureInitialized();
  const filePath = getEnvFilePath(id);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hasForbiddenSegment(targetPath, forbiddenSegments) {
  const parts = path
    .resolve(targetPath)
    .split(/[\\/]+/)
    .map((p) => p.toLowerCase())
    .filter(Boolean);
  for (const rawSeg of forbiddenSegments || []) {
    const cleaned = String(rawSeg).replace(/[\\/]+/g, '').toLowerCase();
    if (cleaned && parts.includes(cleaned)) {
      return cleaned;
    }
  }
  return null;
}

export function validateEnvironment(spec, policy, options = {}) {
  const errors = [];
  const warnings = [];
  const { allowMissing = false, isUpdate = false, existingEnvs = [] } = options;

  if (!spec || typeof spec !== 'object') {
    return { valid: false, errors: ['Environment spec must be a JSON object'], warnings };
  }

  if (!spec.id || !ID_REGEX.test(spec.id)) {
    errors.push(`Invalid id (must match ${ID_REGEX}, e.g. comfyui, stt-whisper, android-sdk)`);
  }
  if (!spec.name || typeof spec.name !== 'string' || !spec.name.trim()) {
    errors.push('Missing required field: name');
  }

  const validCategories = Object.keys(policy.categories || {});
  if (!spec.category || !validCategories.includes(spec.category)) {
    errors.push(`category must be one of: ${validCategories.join(', ')}`);
  }

  const scope = spec.scope || 'machine-singleton';
  if (!VALID_SCOPES.includes(scope)) {
    errors.push(`scope must be one of: ${VALID_SCOPES.join(', ')}`);
  }

  const status = spec.status || 'active';
  if (!VALID_STATUSES.includes(status)) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  if (!spec.summary || typeof spec.summary !== 'string' || !spec.summary.trim()) {
    errors.push('Missing required field: summary');
  }

  if (!spec.root_path || typeof spec.root_path !== 'string' || !spec.root_path.trim()) {
    errors.push('Missing required field: root_path');
  } else {
    if (!path.isAbsolute(spec.root_path)) {
      errors.push(`root_path must be an absolute path: ${spec.root_path}`);
    }
    const matchedSeg = hasForbiddenSegment(spec.root_path, policy.forbidden_path_segments);
    if (matchedSeg) {
      warnings.push(
        `root_path is inside a temporary/unrecommended directory ("${matchedSeg}"): ${spec.root_path}`
      );
    }
    if (!allowMissing && !fs.existsSync(spec.root_path)) {
      errors.push(
        `root_path does not exist: ${spec.root_path} (pass --allow-missing to pre-register)`
      );
    }
  }

  if (spec.executables && typeof spec.executables === 'object') {
    for (const [key, execPath] of Object.entries(spec.executables)) {
      if (typeof execPath !== 'string' || !execPath.trim()) {
        errors.push(`executables.${key} must be a non-empty string`);
        continue;
      }
      if (!allowMissing && path.isAbsolute(execPath) && !fs.existsSync(execPath)) {
        errors.push(`executables.${key} does not exist: ${execPath}`);
      }
    }
  }

  if (spec.health_check?.path && !allowMissing && !fs.existsSync(spec.health_check.path)) {
    errors.push(`health_check.path does not exist: ${spec.health_check.path}`);
  }

  const normalizedRoot = normalizePathForCompare(spec.root_path);
  for (const existing of existingEnvs) {
    if (existing.id === spec.id) {
      if (!isUpdate) {
        errors.push(`id "${spec.id}" already exists; use envreg update or --update`);
      }
      continue;
    }
    if (normalizedRoot && normalizePathForCompare(existing.root_path) === normalizedRoot) {
      errors.push(`Path conflict: root_path is already registered under "${existing.id}" (${existing.name})`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function normalizeEnvSpec(spec, existing = null) {
  const now = new Date().toISOString();
  return {
    id: spec.id,
    name: spec.name?.trim(),
    category: spec.category,
    scope: spec.scope || existing?.scope || 'machine-singleton',
    status: spec.status || existing?.status || 'active',
    summary: spec.summary?.trim(),
    root_path: path.resolve(spec.root_path),
    executables: spec.executables || existing?.executables || {},
    env_vars: spec.env_vars || existing?.env_vars || {},
    shared_resources: Array.isArray(spec.shared_resources)
      ? spec.shared_resources
      : existing?.shared_resources || [],
    service: {
      start_command: spec.service?.start_command ?? existing?.service?.start_command ?? '',
      url: spec.service?.url ?? existing?.service?.url ?? '',
      port: spec.service?.port ?? existing?.service?.port ?? null,
    },
    how_to_use: Array.isArray(spec.how_to_use)
      ? spec.how_to_use
      : existing?.how_to_use || [],
    health_check: {
      path: spec.health_check?.path ?? existing?.health_check?.path ?? path.resolve(spec.root_path),
      command: spec.health_check?.command ?? existing?.health_check?.command ?? '',
    },
    tags: Array.from(new Set([...(Array.isArray(spec.tags) ? spec.tags : existing?.tags || [])])),
    notes: spec.notes ?? existing?.notes ?? '',
    created_at: existing?.created_at || now,
    updated_at: now,
    updated_by: spec.updated_by || existing?.updated_by || process.env.ENVREG_AGENT || 'user',
  };
}

export function saveEnvironment(spec, options = {}) {
  const policy = loadPolicy();
  return withRegistryLock(() => {
    const existingEnvs = listEnvironments();
    const existing = existingEnvs.find((e) => e.id === spec.id) || null;
    const isUpdate = Boolean(options.isUpdate || (options.upsert && existing));

    const validation = validateEnvironment(spec, policy, {
      allowMissing: Boolean(options.allowMissing),
      isUpdate,
      existingEnvs,
    });
    if (!validation.valid) {
      const err = new Error(`Validation failed:\n- ${validation.errors.join('\n- ')}`);
      err.validation = validation;
      throw err;
    }

    const record = normalizeEnvSpec(spec, existing);
    atomicWriteFile(getEnvFilePath(record.id), `${JSON.stringify(record, null, 2)}\n`);
    const allEnvs = listEnvironments();
    writeIndexMarkdownUnlocked(allEnvs, policy);

    return {
      action: existing ? 'updated' : 'created',
      record,
      warnings: validation.warnings,
      total: allEnvs.length,
    };
  });
}

export function removeEnvironment(id) {
  const policy = loadPolicy();
  return withRegistryLock(() => {
    const filePath = getEnvFilePath(id);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Environment not found: ${id}`);
    }
    fs.unlinkSync(filePath);
    const allEnvs = listEnvironments();
    writeIndexMarkdownUnlocked(allEnvs, policy);
    return { id, total: allEnvs.length };
  });
}

export function regenerateIndex() {
  const policy = loadPolicy();
  return withRegistryLock(() => {
    const allEnvs = listEnvironments();
    writeIndexMarkdownUnlocked(allEnvs, policy);
    return allEnvs;
  });
}

function escapeMd(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

export function renderIndexMarkdown(envs, policy) {
  const { registryDir } = getRegistryPaths();
  const lines = [
    '# Machine Shared Environment Registry (Auto-Generated)',
    '',
    `> Registry Directory: \`${registryDir}\`  `,
    `> Default Shared Root: \`${policy.default_shared_root}\`  `,
    `> Updated At: ${new Date().toISOString()}`,
    '',
    '## Core Rules',
    '',
    '1. Before installing or using heavy tools/services (ComfyUI, STT/TTS, reverse engineering, Android SDK, shared models, base toolchains), run `envreg list` / `envreg get <id>` and **reuse existing environments instead of reinstalling inside projects**.',
    '2. Before creating a new machine-singleton shared environment, run `envreg plan --category <cat> --name "<name>"` to check for duplicates and get the standard directory.',
    '3. After creating or modifying a shared environment, run `envreg register` so it is validated and automatically shared with all sessions, workspaces, and agents.',
    '',
    '## Registered Shared Environments',
    '',
  ];

  if (envs.length === 0) {
    lines.push('_No shared environments registered yet. Run `envreg register ...` to add existing ones._');
  } else {
    lines.push('| ID | Category | Status | Root Path | Entry / Service | Summary |');
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');
    for (const e of envs) {
      const execKeys = Object.keys(e.executables || {});
      const entryParts = [];
      if (e.service?.url) entryParts.push(e.service.url);
      if (execKeys.length > 0) entryParts.push(`exec: ${execKeys.join(', ')}`);
      const entryText = entryParts.join(' ; ') || '-';
      lines.push(
        `| \`${escapeMd(e.id)}\` | \`${escapeMd(e.category)}\` | ${escapeMd(e.status)} | \`${escapeMd(e.root_path)}\` | ${escapeMd(entryText)} | ${escapeMd(e.summary)} |`
      );
    }
  }

  lines.push('');
  lines.push('## Quick Commands');
  lines.push('');
  lines.push('- List / search: `envreg list` / `envreg search <keyword>`');
  lines.push('- Inspect details: `envreg get <id>`');
  lines.push('- Plan before creating: `envreg plan --category <category> --name "<name>"`');
  lines.push('- Register & sync: `envreg register --file <json>` (or CLI flags)');
  lines.push('- Health check: `envreg doctor`');
  lines.push('');
  return `${lines.join('\n')}`;
}

function writeIndexMarkdownUnlocked(envs, policy) {
  const { indexMdPath } = getRegistryPaths();
  atomicWriteFile(indexMdPath, renderIndexMarkdown(envs, policy));
}

export function renderManagedBlock(envs, policy) {
  const { indexMdPath } = getRegistryPaths();
  const maxRows = 25;
  const shown = envs.slice(0, maxRows);
  const lines = [
    BLOCK_BEGIN,
    '## 本机共享环境规则（跨会话 / 跨工作区 / 跨 Agent）',
    '',
    `- **先查后用**：涉及开发环境、ComfyUI/生图、语音转文本、逆向、安卓或重型模型/SDK 前，必须先查下方清单或运行 \`envreg list\` / \`envreg get <id>\`（或按 \`machine-env\` Skill 操作），**优先复用，禁止在项目内重复安装**。`,
    `- **规范新建**：确需新建整机只需一份的共享环境时，先运行 \`envreg plan --category <分类> --name <名称>\` 查重并落盘到标准目录（默认 \`${policy.default_shared_root}\`），勿建在临时工作区。`,
    `- **建完必登**：新建或修改共享环境后，必须运行 \`envreg register\` 登记，自动共享给所有会话与 Agent。`,
    `- **真相源**：\`${indexMdPath}\`（完整信息随时以 \`envreg list\` 为准）。`,
  ];

  if (shown.length > 0) {
    lines.push('');
    lines.push('| ID | 分类 | 状态 | 路径 | 用途 |');
    lines.push('| :--- | :--- | :--- | :--- | :--- |');
    for (const e of shown) {
      lines.push(
        `| \`${escapeMd(e.id)}\` | \`${escapeMd(e.category)}\` | ${escapeMd(e.status)} | \`${escapeMd(e.root_path)}\` | ${escapeMd(e.summary)} |`
      );
    }
    if (envs.length > maxRows) {
      lines.push(`| ... | 共 ${envs.length} 项 | - | 运行 \`envreg list\` 查看全部 | - |`);
    }
  } else {
    lines.push('');
    lines.push('> 当前尚未登记已有环境，可使用 `envreg register` 录入 ComfyUI、语音转文本、逆向、安卓等环境。');
  }

  lines.push(BLOCK_END);
  return lines.join('\n');
}
