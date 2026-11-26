import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  BIN_ENTRY,
  BLOCK_BEGIN,
  BLOCK_END,
  SKILL_NAME,
  SKILL_SOURCE_DIR,
  getHomeDir,
} from './constants.mjs';
import { atomicWriteFile, ensureDir, renderManagedBlock } from './store.mjs';

function getDshHome(homeDir) {
  return process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME) : path.join(homeDir, '.dsh');
}

function getXdgConfigHome(homeDir) {
  return process.env.XDG_CONFIG_HOME
    ? path.resolve(process.env.XDG_CONFIG_HOME)
    : path.join(homeDir, '.config');
}

export function getAgentAdapters() {
  const homeDir = getHomeDir();
  const dshDir = getDshHome(homeDir);
  const xdgConfig = getXdgConfigHome(homeDir);

  return [
    {
      id: 'agents-shared',
      name: 'Open Agent Skills Root (~/.agents)',
      detectPaths: [path.join(homeDir, '.agents')],
      alwaysInclude: true,
      skillDir: path.join(homeDir, '.agents', 'skills', SKILL_NAME),
      ruleFile: null,
    },
    {
      id: 'antigravity',
      name: 'Antigravity (~/.gemini/config/plugins/machine-env)',
      detectPaths: [path.join(homeDir, '.gemini', 'config')],
      pluginRoot: path.join(homeDir, '.gemini', 'config', 'plugins', SKILL_NAME),
      skillDir: path.join(homeDir, '.gemini', 'config', 'plugins', SKILL_NAME, 'skills', SKILL_NAME),
      ruleFile: path.join(homeDir, '.gemini', 'config', 'plugins', SKILL_NAME, 'rules', 'AGENTS.md'),
    },
    {
      id: 'codex',
      name: 'OpenAI Codex (~/.codex)',
      detectPaths: [path.join(homeDir, '.codex')],
      skillDir: path.join(homeDir, '.codex', 'skills', SKILL_NAME),
      ruleFile: path.join(homeDir, '.codex', 'AGENTS.md'),
    },
    {
      id: 'dsh',
      name: 'DeepSeek Harness (~/.dsh)',
      detectPaths: [dshDir],
      skillDir: path.join(dshDir, 'skills', SKILL_NAME),
      ruleFile: path.join(dshDir, 'AGENTS.md'),
    },
    {
      id: 'claude',
      name: 'Claude Code (~/.claude)',
      detectPaths: [path.join(homeDir, '.claude')],
      skillDir: path.join(homeDir, '.claude', 'skills', SKILL_NAME),
      ruleFile: path.join(homeDir, '.claude', 'CLAUDE.md'),
    },
    {
      id: 'cursor',
      name: 'Cursor (~/.cursor)',
      detectPaths: [path.join(homeDir, '.cursor')],
      skillDir: path.join(homeDir, '.cursor', 'skills', SKILL_NAME),
      ruleFile: null,
    },
    {
      id: 'gemini-cli',
      name: 'Gemini CLI (~/.gemini/GEMINI.md)',
      detectPaths: [path.join(homeDir, '.gemini', 'GEMINI.md'), path.join(homeDir, '.gemini', 'settings.json')],
      skillDir: path.join(homeDir, '.gemini', 'skills', SKILL_NAME),
      ruleFile: path.join(homeDir, '.gemini', 'GEMINI.md'),
    },
    {
      id: 'windsurf',
      name: 'Windsurf (~/.codeium/windsurf)',
      detectPaths: [path.join(homeDir, '.codeium', 'windsurf'), path.join(homeDir, '.windsurf')],
      skillDir: path.join(homeDir, '.codeium', 'windsurf', 'skills', SKILL_NAME),
      ruleFile: path.join(homeDir, '.codeium', 'windsurf', 'memories', 'global_rules.md'),
    },
    {
      id: 'opencode',
      name: 'OpenCode (~/.config/opencode)',
      detectPaths: [path.join(xdgConfig, 'opencode')],
      skillDir: path.join(xdgConfig, 'opencode', 'skills', SKILL_NAME),
      ruleFile: path.join(xdgConfig, 'opencode', 'AGENTS.md'),
    },
  ];
}

export function detectAdapter(adapter) {
  if (adapter.alwaysInclude) return true;
  return adapter.detectPaths.some((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

const MANAGED_COPY_MARKER = '.envreg-managed';

function ensureSkillLink(linkPath) {
  if (!fs.existsSync(SKILL_SOURCE_DIR)) {
    throw new Error(`Skill source directory not found: ${SKILL_SOURCE_DIR}`);
  }
  ensureDir(path.dirname(linkPath));

  let stat = null;
  try {
    stat = fs.lstatSync(linkPath);
  } catch {
    stat = null;
  }

  if (stat) {
    if (stat.isSymbolicLink()) {
      const target = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
      const same =
        process.platform === 'win32'
          ? target.toLowerCase() === path.resolve(SKILL_SOURCE_DIR).toLowerCase()
          : target === path.resolve(SKILL_SOURCE_DIR);
      if (same) return 'unchanged';
      fs.rmSync(linkPath, { recursive: true, force: true });
    } else if (fs.existsSync(path.join(linkPath, MANAGED_COPY_MARKER))) {
      fs.rmSync(linkPath, { recursive: true, force: true });
    } else {
      const backup = `${linkPath}.bak.${Date.now()}`;
      fs.renameSync(linkPath, backup);
    }
  }

  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  try {
    fs.symlinkSync(SKILL_SOURCE_DIR, linkPath, linkType);
    return 'linked';
  } catch (err) {
    if (!['EPERM', 'EACCES', 'ENOTSUP', 'EXDEV', 'EROFS'].includes(err.code)) {
      throw err;
    }
    fs.cpSync(SKILL_SOURCE_DIR, linkPath, { recursive: true });
    fs.writeFileSync(
      path.join(linkPath, MANAGED_COPY_MARKER),
      `managed by envreg (${new Date().toISOString()})\n`,
      'utf8'
    );
    return 'copied';
  }
}

function removeSkillLink(linkPath) {
  let stat = null;
  try {
    stat = fs.lstatSync(linkPath);
  } catch {
    return 'not-present';
  }
  if (!stat.isSymbolicLink() && !fs.existsSync(path.join(linkPath, MANAGED_COPY_MARKER))) {
    return 'skipped (not managed by envreg)';
  }
  fs.rmSync(linkPath, { recursive: true, force: true });
  return 'removed';
}

function upsertManagedBlock(ruleFile, blockText) {
  ensureDir(path.dirname(ruleFile));
  let content = '';
  let existed = false;

  if (fs.existsSync(ruleFile)) {
    existed = true;
    content = fs.readFileSync(ruleFile, 'utf8');
  }

  const startIdx = content.indexOf(BLOCK_BEGIN);
  const endIdx = content.indexOf(BLOCK_END);

  let nextContent;
  if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + BLOCK_END.length);
    nextContent = `${before}${blockText}${after}`;
  } else if (!existed || !content.trim()) {
    nextContent = `${blockText}\n`;
  } else {
    const sep = content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
    nextContent = `${content}${sep}${blockText}\n`;
  }

  if (existed && content === nextContent) {
    return 'unchanged';
  }

  if (existed && startIdx === -1) {
    const bakPath = `${ruleFile}.envreg.bak`;
    if (!fs.existsSync(bakPath)) {
      fs.copyFileSync(ruleFile, bakPath);
    }
  }

  atomicWriteFile(ruleFile, nextContent);
  return existed ? 'updated' : 'created';
}

function removeManagedBlock(ruleFile) {
  if (!fs.existsSync(ruleFile)) return 'not-present';
  const content = fs.readFileSync(ruleFile, 'utf8');
  const startIdx = content.indexOf(BLOCK_BEGIN);
  const endIdx = content.indexOf(BLOCK_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return 'not-present';
  }
  const before = content.slice(0, startIdx).replace(/\r?\n+$/, '');
  const after = content.slice(endIdx + BLOCK_END.length).replace(/^\r?\n+/, '');
  const next = [before, after].filter(Boolean).join('\n\n');
  atomicWriteFile(ruleFile, next ? `${next}\n` : '');
  return 'removed';
}

function ensureAntigravityPluginManifest(pluginRoot) {
  ensureDir(pluginRoot);
  const manifestPath = path.join(pluginRoot, 'plugin.json');
  const manifest = {
    name: SKILL_NAME,
    description: 'Cross-session, cross-workspace, cross-agent machine shared environment registry',
  };
  if (!fs.existsSync(manifestPath)) {
    atomicWriteFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return 'created';
  }
  return 'unchanged';
}

export function resolveGlobalBinDir() {
  if (process.env.ENVREG_BIN_DIR) {
    return path.resolve(process.env.ENVREG_BIN_DIR);
  }
  if (process.platform === 'win32') {
    try {
      const prefix = execSync('npm prefix -g', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (prefix && fs.existsSync(prefix)) return prefix;
    } catch {
      // fallback below
    }
    if (process.env.APPDATA) {
      return path.join(process.env.APPDATA, 'npm');
    }
  }
  return path.join(getHomeDir(), '.local', 'bin');
}

function toAsciiJsString(str) {
  return JSON.stringify(str).replace(/[\u0080-\uffff]/g, (ch) => {
    return `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
}

export function installCliShims() {
  const binDir = resolveGlobalBinDir();
  ensureDir(binDir);
  const nodeExe = process.execPath;
  const written = [];

  if (process.platform === 'win32') {
    const launcherPath = path.join(binDir, 'envreg-launcher.mjs');
    const cmdPath = path.join(binDir, 'envreg.cmd');
    const ps1Path = path.join(binDir, 'envreg.ps1');
    const shPath = path.join(binDir, 'envreg');

    const launcherContent = [
      "import { pathToFileURL } from 'node:url';",
      `const entry = ${toAsciiJsString(BIN_ENTRY)};`,
      'await import(pathToFileURL(entry).href);',
      '',
    ].join('\n');

    const cmdContent = `@echo off\r\n"${nodeExe}" "%~dp0envreg-launcher.mjs" %*\r\n`;
    const ps1Content = `& "${nodeExe}" "$PSScriptRoot\\envreg-launcher.mjs" @args\r\nexit $LASTEXITCODE\r\n`;
    const shNode = nodeExe.replace(/\\/g, '/');
    const shContent = `#!/bin/sh\nDIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "${shNode}" "$DIR/envreg-launcher.mjs" "$@"\n`;

    atomicWriteFile(launcherPath, launcherContent);
    atomicWriteFile(cmdPath, cmdContent);
    atomicWriteFile(ps1Path, ps1Content);
    atomicWriteFile(shPath, shContent);
    written.push(launcherPath, cmdPath, ps1Path, shPath);
  } else {
    const shPath = path.join(binDir, 'envreg');
    const shContent = `#!/bin/sh\nexec "${nodeExe}" "${BIN_ENTRY}" "$@"\n`;
    atomicWriteFile(shPath, shContent);
    fs.chmodSync(shPath, 0o755);
    written.push(shPath);
  }

  return { binDir, written };
}

export function setupAllAgents(envs, policy, { onlyIds = null, installShim = true } = {}) {
  const blockText = renderManagedBlock(envs, policy);
  const adapters = getAgentAdapters();
  const report = {
    shim: null,
    agents: [],
  };

  if (installShim) {
    try {
      report.shim = { ok: true, ...installCliShims() };
    } catch (err) {
      report.shim = { ok: false, error: err.message };
    }
  }

  for (const adapter of adapters) {
    if (onlyIds && !onlyIds.includes(adapter.id)) {
      continue;
    }
    const detected = onlyIds ? true : detectAdapter(adapter);
    if (!detected) {
      report.agents.push({ id: adapter.id, name: adapter.name, status: 'skipped (not detected)' });
      continue;
    }

    const item = {
      id: adapter.id,
      name: adapter.name,
      status: 'ok',
      actions: {},
    };

    try {
      if (adapter.pluginRoot) {
        item.actions.plugin = ensureAntigravityPluginManifest(adapter.pluginRoot);
      }
      if (adapter.skillDir) {
        item.actions.skill = `${ensureSkillLink(adapter.skillDir)} -> ${adapter.skillDir}`;
      }
      if (adapter.ruleFile) {
        item.actions.rule = `${upsertManagedBlock(adapter.ruleFile, blockText)} -> ${adapter.ruleFile}`;
      }
    } catch (err) {
      item.status = 'error';
      item.error = err.message;
    }

    report.agents.push(item);
  }

  return report;
}

export function uninstallAllAgents({ onlyIds = null } = {}) {
  const adapters = getAgentAdapters();
  const results = [];

  for (const adapter of adapters) {
    if (onlyIds && !onlyIds.includes(adapter.id)) continue;
    const item = { id: adapter.id, name: adapter.name, actions: {} };
    try {
      if (adapter.skillDir) {
        item.actions.skill = removeSkillLink(adapter.skillDir);
      }
      if (adapter.ruleFile) {
        item.actions.rule = removeManagedBlock(adapter.ruleFile);
      }
      if (adapter.pluginRoot && fs.existsSync(adapter.pluginRoot)) {
        fs.rmSync(adapter.pluginRoot, { recursive: true, force: true });
        item.actions.plugin = 'removed';
      }
      item.status = 'ok';
    } catch (err) {
      item.status = 'error';
      item.error = err.message;
    }
    results.push(item);
  }

  return results;
}

export function syncAgentRules(envs, policy) {
  const blockText = renderManagedBlock(envs, policy);
  const adapters = getAgentAdapters();
  const results = [];

  for (const adapter of adapters) {
    if (!adapter.ruleFile) continue;
    if (!detectAdapter(adapter)) continue;
    try {
      const action = upsertManagedBlock(adapter.ruleFile, blockText);
      results.push({ id: adapter.id, ruleFile: adapter.ruleFile, ok: true, action });
    } catch (err) {
      results.push({ id: adapter.id, ruleFile: adapter.ruleFile, ok: false, error: err.message });
    }
  }

  return results;
}

export function inspectAgentIntegration() {
  const adapters = getAgentAdapters();
  return adapters.map((adapter) => {
    const detected = detectAdapter(adapter);
    let skillLinked = false;
    let ruleSynced = false;

    if (adapter.skillDir) {
      try {
        skillLinked = fs.existsSync(path.join(adapter.skillDir, 'SKILL.md'));
      } catch {
        skillLinked = false;
      }
    }

    if (adapter.ruleFile) {
      try {
        if (fs.existsSync(adapter.ruleFile)) {
          const text = fs.readFileSync(adapter.ruleFile, 'utf8');
          ruleSynced = text.includes(BLOCK_BEGIN) && text.includes(BLOCK_END);
        }
      } catch {
        ruleSynced = false;
      }
    }

    return {
      id: adapter.id,
      name: adapter.name,
      detected,
      skill: adapter.skillDir ? (skillLinked ? 'linked' : 'missing') : 'n/a',
      rule: adapter.ruleFile ? (ruleSynced ? 'synced' : 'missing') : 'n/a',
    };
  });
}
