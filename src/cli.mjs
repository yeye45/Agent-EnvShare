import fs from 'node:fs';
import path from 'node:path';
import {
  ID_REGEX,
  SKILL_SOURCE_DIR,
  getPackageVersion,
  getRegistryPaths,
} from './constants.mjs';
import {
  getEnvironment,
  initRegistry,
  listEnvironments,
  loadPolicy,
  regenerateIndex,
  removeEnvironment,
  saveEnvironment,
  savePolicy,
} from './store.mjs';
import { runDoctor } from './doctor.mjs';
import {
  inspectAgentIntegration,
  setupAllAgents,
  syncAgentRules,
  uninstallAllAgents,
} from './adapters.mjs';

function parseCliArgs(argv) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const eqIdx = token.indexOf('=');
    let key;
    let value;
    if (eqIdx !== -1) {
      key = token.slice(2, eqIdx);
      value = token.slice(eqIdx + 1);
    } else {
      key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        value = next;
        i += 1;
      } else {
        value = true;
      }
    }

    if (flags[key] === undefined) {
      flags[key] = value;
    } else if (Array.isArray(flags[key])) {
      flags[key].push(value);
    } else {
      flags[key] = [flags[key], value];
    }
  }

  return { flags, positional };
}

function asArray(val) {
  if (val === undefined || val === true) return [];
  return Array.isArray(val) ? val : [val];
}

function parseKeyValuePairs(items) {
  const obj = {};
  for (const raw of asArray(items)) {
    const idx = String(raw).indexOf('=');
    if (idx <= 0) {
      throw new Error(`Invalid key=value argument: ${raw}`);
    }
    const k = raw.slice(0, idx).trim();
    const v = raw.slice(idx + 1).trim();
    obj[k] = v;
  }
  return obj;
}

function slugifyId(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function printTable(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length))
  );
  const pad = (s, w) => String(s ?? '').padEnd(w, ' ');
  console.log(headers.map((h, i) => pad(h, widths[i])).join('  '));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) {
    console.log(row.map((c, i) => pad(c, widths[i])).join('  '));
  }
}

function printHelp() {
  const { registryDir } = getRegistryPaths();
  console.log(`envreg v${getPackageVersion()} — Cross-Agent Machine Shared Environment Registry

Usage:
  envreg init [--registry <dir>] [--shared-root <dir>] [--json]
  envreg setup [--only <id1,id2>] [--no-shim] [--json]
  envreg list [--category <cat>] [--status <st>] [--json]
  envreg search <keyword> [--json]
  envreg get <id> [--json]
  envreg plan --category <cat> --name "<Name>" [--id <id>] [--json]
  envreg register (--file <path> | --stdin | --id <id> --name "<Name>" --category <cat> --root <path> --summary "<Summary>" [options])
  envreg update <id> [register options]
  envreg remove <id> [--no-sync] [--json]
  envreg doctor [<id>] [--fix-status] [--json]
  envreg sync [--json]
  envreg policy [--set-root <dir>] [--json]
  envreg status [--json]
  envreg uninstall [--only <id1,id2>] [--json]
  envreg version

register / update options:
  --id <id>                 Unique kebab-case ID (e.g. comfyui, stt-whisper, android-sdk)
  --name <name>             Human-readable name
  --category <cat>          dev | ai-image | ai-audio | ai-llm | reverse | android | shared-models | other
  --root <abs-path>         Absolute root path of the environment
  --summary <text>          One-line summary of purpose
  --exec <k=v>              Key executable path (repeatable, e.g. --exec python=/path/to/python)
  --env <K=V>               Key environment variable (repeatable)
  --resource <path>         Shared models/caches directory (repeatable)
  --start-cmd <cmd>         Service launch command
  --url <url>               Service URL (e.g. http://127.0.0.1:8188)
  --port <port>             Service port number
  --use <note>              Usage instruction or caveat (repeatable)
  --check-path <path>       Health check path (defaults to --root)
  --check-cmd <cmd>         Health check command (exit 0 = healthy)
  --tag <tags>              Search tags (comma-separated or repeatable)
  --notes <text>            Extra notes / pitfalls
  --updated-by <agent>      Source agent name (e.g. antigravity, codex, dsh, claude)
  --update                  Upsert if id already exists
  --allow-missing           Allow pre-registering a non-existent path
  --no-sync                 Skip syncing managed blocks to external agents

Active Registry: ${registryDir}`);
}

function readSpecFromFlags(flags, existing = null) {
  let base = existing ? { ...existing } : {};

  if (flags.file && flags.file !== true) {
    const fileData = JSON.parse(fs.readFileSync(path.resolve(flags.file), 'utf8'));
    base = { ...base, ...fileData };
  } else if (flags.stdin) {
    const raw = fs.readFileSync(0, 'utf8').trim();
    if (!raw) throw new Error('--stdin received empty input');
    const stdinData = JSON.parse(raw);
    base = { ...base, ...stdinData };
  }

  if (flags.id && flags.id !== true) base.id = flags.id;
  if (flags.name && flags.name !== true) base.name = flags.name;
  if (flags.category && flags.category !== true) base.category = flags.category;
  if (flags.scope && flags.scope !== true) base.scope = flags.scope;
  if (flags.status && flags.status !== true) base.status = flags.status;
  if (flags.summary && flags.summary !== true) base.summary = flags.summary;
  if (flags.root && flags.root !== true) base.root_path = flags.root;
  if (flags.notes && flags.notes !== true) base.notes = flags.notes;
  if (flags['updated-by'] && flags['updated-by'] !== true) base.updated_by = flags['updated-by'];

  if (flags.exec !== undefined) {
    base.executables = { ...(base.executables || {}), ...parseKeyValuePairs(flags.exec) };
  }
  if (flags.env !== undefined) {
    base.env_vars = { ...(base.env_vars || {}), ...parseKeyValuePairs(flags.env) };
  }
  if (flags.resource !== undefined) {
    base.shared_resources = Array.from(
      new Set([...(base.shared_resources || []), ...asArray(flags.resource)])
    );
  }
  if (flags.use !== undefined) {
    base.how_to_use = [...(base.how_to_use || []), ...asArray(flags.use)];
  }
  if (flags.tag !== undefined) {
    const tags = asArray(flags.tag)
      .flatMap((t) => String(t).split(','))
      .map((t) => t.trim())
      .filter(Boolean);
    base.tags = Array.from(new Set([...(base.tags || []), ...tags]));
  }

  const service = { ...(base.service || {}) };
  if (flags['start-cmd'] && flags['start-cmd'] !== true) service.start_command = flags['start-cmd'];
  if (flags.url && flags.url !== true) service.url = flags.url;
  if (flags.port && flags.port !== true) {
    const p = Number(flags.port);
    if (!Number.isInteger(p) || p <= 0 || p > 65535) {
      throw new Error(`Invalid port number: ${flags.port}`);
    }
    service.port = p;
  }
  base.service = service;

  const healthCheck = { ...(base.health_check || {}) };
  if (flags['check-path'] && flags['check-path'] !== true) healthCheck.path = flags['check-path'];
  if (flags['check-cmd'] && flags['check-cmd'] !== true) healthCheck.command = flags['check-cmd'];
  base.health_check = healthCheck;

  return base;
}

function cmdInit(flags) {
  const result = initRegistry({
    registryDir: typeof flags.registry === 'string' ? flags.registry : null,
    sharedRoot: typeof flags['shared-root'] === 'string' ? flags['shared-root'] : null,
    forcePolicy: Boolean(flags.force),
  });

  if (flags.json) {
    printJson(result);
    return;
  }

  console.log(`[OK] Registry initialized: ${result.registry_dir}`);
  console.log(`Policy (${result.policy_action}): ${result.policy_path}`);
  console.log(`Default shared root: ${result.default_shared_root}`);
  console.log(`Index: ${result.index_md} (${result.environment_count} environments)`);
}

function cmdList(flags) {
  const { registryDir } = getRegistryPaths();
  const envs = listEnvironments({
    category: typeof flags.category === 'string' ? flags.category : undefined,
    status: typeof flags.status === 'string' ? flags.status : undefined,
  });

  if (flags.json) {
    printJson({ registry: registryDir, count: envs.length, environments: envs });
    return;
  }

  if (envs.length === 0) {
    console.log('当前没有已登记的共享环境。');
    console.log(`注册表路径：${registryDir}`);
    console.log('使用 `envreg help` 查看登记方式。');
    return;
  }

  printTable(
    ['ID', 'CATEGORY', 'STATUS', 'ROOT_PATH', 'SUMMARY'],
    envs.map((e) => [e.id, e.category, e.status, e.root_path, e.summary])
  );
}

function cmdSearch(positional, flags) {
  const query = positional.join(' ').trim();
  if (!query) throw new Error('Please provide a search keyword: envreg search <keyword>');
  const envs = listEnvironments({ query });
  if (flags.json) {
    printJson({ query, count: envs.length, environments: envs });
    return;
  }
  if (envs.length === 0) {
    console.log(`未找到匹配 "${query}" 的共享环境。`);
    return;
  }
  printTable(
    ['ID', 'CATEGORY', 'STATUS', 'ROOT_PATH', 'SUMMARY'],
    envs.map((e) => [e.id, e.category, e.status, e.root_path, e.summary])
  );
}

function cmdGet(positional, flags) {
  const id = positional[0];
  if (!id) throw new Error('Please provide an environment id: envreg get <id>');
  const env = getEnvironment(id);
  if (!env) throw new Error(`Environment not found: ${id}`);
  if (flags.json) {
    printJson(env);
    return;
  }
  console.log(`# ${env.name} (${env.id})`);
  console.log(`Category: ${env.category} | Scope: ${env.scope} | Status: ${env.status}`);
  console.log(`Summary: ${env.summary}`);
  console.log(`Root Path: ${env.root_path}`);
  if (env.executables && Object.keys(env.executables).length > 0) {
    console.log('Executables:');
    for (const [k, v] of Object.entries(env.executables)) {
      console.log(`  - ${k}: ${v}`);
    }
  }
  if (env.env_vars && Object.keys(env.env_vars).length > 0) {
    console.log('Env Vars:');
    for (const [k, v] of Object.entries(env.env_vars)) {
      console.log(`  - ${k}=${v}`);
    }
  }
  if (env.shared_resources?.length > 0) {
    console.log('Shared Resources / Models:');
    for (const r of env.shared_resources) console.log(`  - ${r}`);
  }
  if (env.service?.url || env.service?.start_command || env.service?.port) {
    console.log('Service:');
    if (env.service.url) console.log(`  - URL: ${env.service.url}`);
    if (env.service.port) console.log(`  - Port: ${env.service.port}`);
    if (env.service.start_command) console.log(`  - Start Command: ${env.service.start_command}`);
  }
  if (env.how_to_use?.length > 0) {
    console.log('How To Use:');
    for (const tip of env.how_to_use) console.log(`  - ${tip}`);
  }
  if (env.health_check?.path || env.health_check?.command) {
    console.log('Health Check:');
    if (env.health_check.path) console.log(`  - Path: ${env.health_check.path}`);
    if (env.health_check.command) console.log(`  - Command: ${env.health_check.command}`);
  }
  if (env.tags?.length > 0) console.log(`Tags: ${env.tags.join(', ')}`);
  if (env.notes) console.log(`Notes: ${env.notes}`);
  console.log(`Updated: ${env.updated_at} (by ${env.updated_by})`);
}

function cmdPlan(flags) {
  const policy = loadPolicy();
  const category = typeof flags.category === 'string' ? flags.category : '';
  const name = typeof flags.name === 'string' ? flags.name : '';

  if (!category || !policy.categories[category]) {
    throw new Error(
      `Please specify a valid --category (${Object.keys(policy.categories).join(', ')})`
    );
  }
  if (!name) {
    throw new Error('Please specify --name "<Environment Name>"');
  }

  const proposedId =
    typeof flags.id === 'string' && flags.id.trim()
      ? flags.id.trim()
      : slugifyId(name) || `${category}-env`;

  if (!ID_REGEX.test(proposedId)) {
    throw new Error(`Proposed id "${proposedId}" is invalid; pass a valid kebab-case --id`);
  }

  const catInfo = policy.categories[category];
  const recommendedPath = path.join(policy.default_shared_root, catInfo.subdir, proposedId);

  const sameCategory = listEnvironments({ category });
  const similarByQuery = listEnvironments({ query: name }).filter(
    (e) => !sameCategory.some((c) => c.id === e.id)
  );
  const existingMatches = [...sameCategory, ...similarByQuery].map((e) => ({
    id: e.id,
    name: e.name,
    status: e.status,
    root_path: e.root_path,
    summary: e.summary,
  }));

  const plan = {
    category,
    category_label: catInfo.label,
    proposed_id: proposedId,
    recommended_root_path: recommendedPath,
    default_shared_root: policy.default_shared_root,
    existing_in_category_or_similar: existingMatches,
    checklist: [
      existingMatches.length > 0
        ? 'Check existing environments in this category first and reuse them if possible.'
        : 'No existing environment found in this category; safe to create a new shared one.',
      `Install under the standard shared path (not in a project repo or temp dir): ${recommendedPath}`,
      'Verify the installation works and prepare a health_check path or command.',
      `Register immediately when done: envreg register --id ${proposedId} --name "${name}" --category ${category} --root "${recommendedPath}" --summary "<purpose>"`,
    ],
  };

  if (flags.json) {
    printJson(plan);
    return;
  }

  console.log('=== Shared Environment Plan ===');
  console.log(`Category: ${category} (${catInfo.label})`);
  console.log(`Proposed ID: ${proposedId}`);
  console.log(`Recommended Root Path: ${recommendedPath}`);
  if (existingMatches.length > 0) {
    console.log('\n[WARN] Existing similar environments found (prefer reusing):');
    for (const m of existingMatches) {
      console.log(`  - ${m.id} (${m.status}): ${m.root_path} — ${m.summary}`);
    }
  } else {
    console.log('\nNo conflicting environment found in this category.');
  }
  console.log('\nChecklist:');
  for (const [i, item] of plan.checklist.entries()) {
    console.log(`  ${i + 1}. ${item}`);
  }
}

function cmdRegister(flags, { forceUpdate = false, targetId = null } = {}) {
  const existing = targetId ? getEnvironment(targetId) : null;
  if (forceUpdate && !existing) {
    throw new Error(`Environment not found: ${targetId}`);
  }

  const spec = readSpecFromFlags(flags, existing);
  if (targetId) spec.id = targetId;

  const result = saveEnvironment(spec, {
    isUpdate: forceUpdate,
    upsert: Boolean(flags.update),
    allowMissing: Boolean(flags['allow-missing']),
  });

  let syncReport = [];
  if (!flags['no-sync']) {
    const policy = loadPolicy();
    const allEnvs = listEnvironments();
    syncReport = syncAgentRules(allEnvs, policy);
  }

  const { indexMdPath } = getRegistryPaths();
  if (flags.json) {
    printJson({ ...result, index_md: indexMdPath, sync: syncReport });
    return;
  }

  console.log(
    `[OK] ${result.action === 'created' ? 'Registered' : 'Updated'}: ${result.record.id} (${result.record.name})`
  );
  console.log(`Root Path: ${result.record.root_path}`);
  console.log(`Index refreshed: ${indexMdPath}`);

  for (const w of result.warnings) {
    console.log(`[WARN] ${w}`);
  }

  if (syncReport.length > 0) {
    const okCount = syncReport.filter((s) => s.ok).length;
    const failed = syncReport.filter((s) => !s.ok);
    console.log(`Agent rule sync: ${okCount}/${syncReport.length} succeeded`);
    for (const f of failed) {
      console.log(`  [INFO] ${f.id} could not be synced (${f.error}) — SSOT is live; run envreg sync later.`);
    }
  }
}

function cmdRemove(positional, flags) {
  const id = positional[0];
  if (!id) throw new Error('Please specify an environment id: envreg remove <id>');
  const result = removeEnvironment(id);

  let syncReport = [];
  if (!flags['no-sync']) {
    syncReport = syncAgentRules(listEnvironments(), loadPolicy());
  }

  const { indexMdPath } = getRegistryPaths();
  if (flags.json) {
    printJson({ removed: result.id, total: result.total, index_md: indexMdPath, sync: syncReport });
    return;
  }
  console.log(`[OK] Removed from registry: ${result.id} (physical files untouched)`);
  console.log(`Index refreshed: ${indexMdPath}`);
}

async function cmdDoctor(positional, flags) {
  const id = positional[0];
  const report = await runDoctor({
    id,
    fixStatus: Boolean(flags['fix-status']),
  });

  if (report.status_updated > 0 && !flags['no-sync']) {
    syncAgentRules(listEnvironments(), loadPolicy());
  }

  if (flags.json) {
    printJson(report);
    return;
  }

  if (report.checked === 0) {
    console.log('No registered shared environments to check.');
    return;
  }

  console.log(`=== Shared Environment Doctor (${report.healthy}/${report.checked} healthy) ===`);
  for (const r of report.results) {
    const icon = r.healthy ? '[OK]  ' : '[FAIL]';
    const portInfo =
      r.details.service_port_open === null
        ? ''
        : r.details.service_port_open
          ? ' | port open'
          : ' | port closed';
    const changeInfo = r.status_changed ? ` | status: ${r.status_changed}` : '';
    console.log(`${icon} ${r.id} (${r.category}) - ${r.name}${portInfo}${changeInfo}`);
    for (const issue of r.issues) {
      console.log(`       -> ${issue}`);
    }
  }
}

function cmdSetup(flags) {
  const envs = regenerateIndex();
  const policy = loadPolicy();
  const onlyIds =
    typeof flags.only === 'string'
      ? flags.only
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : null;

  const report = setupAllAgents(envs, policy, {
    onlyIds,
    installShim: !flags['no-shim'],
  });

  if (flags.json) {
    printJson(report);
    return;
  }

  console.log('=== envreg Multi-Agent Setup Report ===');
  if (report.shim) {
    if (report.shim.ok) {
      console.log(`[CLI] Global shims installed in: ${report.shim.binDir}`);
    } else {
      console.log(`[CLI] Global shim install skipped/failed: ${report.shim.error}`);
    }
  }

  for (const a of report.agents) {
    console.log(`\n[${a.status.toUpperCase()}] ${a.name} (${a.id})`);
    if (a.error) {
      console.log(`  Error: ${a.error}`);
    }
    if (a.actions) {
      for (const [k, v] of Object.entries(a.actions)) {
        console.log(`  - ${k}: ${v}`);
      }
    }
  }
}

function cmdUninstall(flags) {
  const onlyIds =
    typeof flags.only === 'string'
      ? flags.only
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : null;

  const results = uninstallAllAgents({ onlyIds });
  if (flags.json) {
    printJson({ uninstalled: results });
    return;
  }

  console.log('=== envreg Agent Integration Removed (registry data untouched) ===');
  for (const r of results) {
    console.log(`[${r.status.toUpperCase()}] ${r.id}: ${JSON.stringify(r.actions)}`);
  }
}

function cmdSync(flags) {
  const envs = regenerateIndex();
  const policy = loadPolicy();
  const results = syncAgentRules(envs, policy);
  const { indexMdPath } = getRegistryPaths();

  if (flags.json) {
    printJson({ index: indexMdPath, results });
    return;
  }

  console.log(`Index refreshed: ${indexMdPath} (${envs.length} environments)`);
  for (const r of results) {
    if (r.ok) {
      console.log(`  [OK]   ${r.id}: ${r.action} (${r.ruleFile})`);
    } else {
      console.log(`  [FAIL] ${r.id}: ${r.error} (${r.ruleFile})`);
    }
  }
}

function cmdPolicy(flags) {
  const policy = loadPolicy();
  const { policyPath } = getRegistryPaths();

  if (typeof flags['set-root'] === 'string' && flags['set-root'].trim()) {
    const nextRoot = path.resolve(flags['set-root'].trim());
    policy.default_shared_root = nextRoot;
    savePolicy(policy);
    const envs = regenerateIndex();
    if (!flags['no-sync']) syncAgentRules(envs, policy);
  }

  if (flags.json) {
    printJson(policy);
    return;
  }

  console.log('=== Machine Shared Environment Policy ===');
  console.log(`Policy File: ${policyPath}`);
  console.log(`Default Shared Root: ${policy.default_shared_root}`);
  console.log(`Existing Env Policy: ${policy.existing_env_policy}`);
  console.log(`Naming Rule: ${policy.naming_rule}`);
  console.log('\nCategories:');
  for (const [k, v] of Object.entries(policy.categories)) {
    console.log(`  - ${k} (${v.label}) -> ${v.subdir}/`);
  }
  console.log('\nShared Pool Criteria:');
  for (const c of policy.shared_criteria) console.log(`  - ${c}`);
}

function cmdStatus(flags) {
  const paths = getRegistryPaths();
  const envs = listEnvironments();
  const policy = loadPolicy();
  const agents = inspectAgentIntegration();
  const data = {
    version: getPackageVersion(),
    registry_dir: paths.registryDir,
    environments_dir: paths.environmentsDir,
    index_md: paths.indexMdPath,
    skill_source: SKILL_SOURCE_DIR,
    default_shared_root: policy.default_shared_root,
    environment_count: envs.length,
    agents,
  };

  if (flags.json) {
    printJson(data);
    return;
  }

  console.log(`envreg v${data.version}`);
  console.log(`Registry Dir: ${paths.registryDir}`);
  console.log(`Skill Source: ${SKILL_SOURCE_DIR}`);
  console.log(`Default Shared Root: ${policy.default_shared_root}`);
  console.log(`Registered Environments: ${envs.length}`);
  console.log('\nAgent Integration Status:');
  printTable(
    ['AGENT', 'DETECTED', 'SKILL', 'RULE'],
    agents.map((a) => [a.id, a.detected ? 'yes' : 'no', a.skill, a.rule])
  );
}

export async function runCli(argv) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }
  if (command === 'version' || command === '--version' || command === '-v') {
    console.log(getPackageVersion());
    return;
  }

  const { flags, positional } = parseCliArgs(rest);

  switch (command) {
    case 'init':
      cmdInit(flags);
      break;
    case 'list':
    case 'ls':
      cmdList(flags);
      break;
    case 'search':
    case 'find':
      cmdSearch(positional, flags);
      break;
    case 'get':
    case 'show':
      cmdGet(positional, flags);
      break;
    case 'plan':
      cmdPlan(flags);
      break;
    case 'register':
    case 'add':
      cmdRegister(flags);
      break;
    case 'update':
      cmdRegister(flags, { forceUpdate: true, targetId: positional[0] });
      break;
    case 'remove':
    case 'rm':
      cmdRemove(positional, flags);
      break;
    case 'doctor':
    case 'check':
      await cmdDoctor(positional, flags);
      break;
    case 'setup':
      cmdSetup(flags);
      break;
    case 'uninstall':
      cmdUninstall(flags);
      break;
    case 'sync':
      cmdSync(flags);
      break;
    case 'policy':
      cmdPolicy(flags);
      break;
    case 'status':
      cmdStatus(flags);
      break;
    default:
      throw new Error(`Unknown command: ${command} (run "envreg help" for usage)`);
  }
}
