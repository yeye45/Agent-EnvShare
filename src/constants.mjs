import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PACKAGE_ROOT = path.resolve(__dirname, '..');
export const BIN_ENTRY = path.join(PACKAGE_ROOT, 'bin', 'envreg.mjs');
export const TEMPLATES_DIR = path.join(PACKAGE_ROOT, 'templates');
export const DEFAULT_POLICY_TEMPLATE = path.join(TEMPLATES_DIR, 'policy.default.json');
export const EXAMPLE_ENV_TEMPLATE = path.join(TEMPLATES_DIR, 'environment.example.json');

export const SKILL_NAME = 'machine-env';
export const SKILL_SOURCE_DIR = path.join(PACKAGE_ROOT, 'skill', SKILL_NAME);

export const BLOCK_BEGIN = '<!-- BEGIN MACHINE-ENV-REGISTRY (managed by envreg) -->';
export const BLOCK_END = '<!-- END MACHINE-ENV-REGISTRY -->';

export const ID_REGEX = /^[a-z0-9][a-z0-9-]{1,47}$/;
export const VALID_SCOPES = ['machine-singleton', 'machine-shared'];
export const VALID_STATUSES = ['active', 'inactive', 'broken', 'deprecated'];

export function getPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function getHomeDir() {
  return process.env.ENVREG_HOME ? path.resolve(process.env.ENVREG_HOME) : os.homedir();
}

export function getUserConfigPath() {
  return path.join(getHomeDir(), '.envreg.json');
}

export function readUserConfig() {
  const cfgPath = getUserConfigPath();
  if (!fs.existsSync(cfgPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch {
    return {};
  }
}

export function writeUserConfig(cfg) {
  const cfgPath = getUserConfigPath();
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  const tmpPath = `${cfgPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, cfgPath);
}

export function getDefaultSharedRoot() {
  return path.join(getHomeDir(), 'SharedEnvs');
}

export function getRegistryPaths() {
  let registryDir;
  if (process.env.SHARED_ENV_REGISTRY) {
    registryDir = path.resolve(process.env.SHARED_ENV_REGISTRY);
  } else {
    const userCfg = readUserConfig();
    registryDir = userCfg.registry_dir
      ? path.resolve(userCfg.registry_dir)
      : path.join(getHomeDir(), '.machine-env');
  }

  return {
    registryDir,
    policyPath: path.join(registryDir, 'policy.json'),
    environmentsDir: path.join(registryDir, 'environments'),
    indexMdPath: path.join(registryDir, 'INDEX.md'),
    lockPath: path.join(registryDir, '.envreg.lock'),
  };
}
