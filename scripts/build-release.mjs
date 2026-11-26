import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(REPO_ROOT, 'dist');

const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const version = pkg.version;

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function copyEntry(relPath, targetRoot) {
  const src = path.join(REPO_ROOT, relPath);
  const dst = path.join(targetRoot, relPath);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing release entry: ${relPath}`);
  }
  fs.cpSync(src, dst, { recursive: true });
}

function scanForLeaks(dir) {
  const forbidden = ['\\Users\\eryis', '/Users/eryis', '环境维护'];
  const binaryExts = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.zip', '.tgz']);
  const hits = [];

  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        if (binaryExts.has(path.extname(entry.name).toLowerCase())) continue;
        const text = fs.readFileSync(full, 'utf8');
        for (const token of forbidden) {
          if (text.includes(token)) {
            hits.push(`${path.relative(dir, full)} contains "${token}"`);
          }
        }
      }
    }
  }

  walk(dir);
  if (hits.length > 0) {
    throw new Error(`Personal path leak detected in release staging:\n- ${hits.join('\n- ')}`);
  }
}

fs.rmSync(DIST_DIR, { recursive: true, force: true });
fs.mkdirSync(DIST_DIR, { recursive: true });

// 1. Stage clean release folder
const stageName = `Agent-EnvShare-v${version}`;
const stageDir = path.join(DIST_DIR, stageName);
fs.mkdirSync(stageDir, { recursive: true });

const releaseEntries = ['package.json', ...pkg.files];
for (const rel of releaseEntries) {
  copyEntry(rel, stageDir);
}

// Sanity check: ensure zero personal paths leaked into release
scanForLeaks(stageDir);

// 2. Build npm tarball (.tgz)
console.log('Packing npm tarball...');
const tmpNpmCache = path.join(DIST_DIR, '.npm-cache');
fs.mkdirSync(tmpNpmCache, { recursive: true });
const packOutput = execSync(
  `npm pack --pack-destination "${DIST_DIR}" --cache "${tmpNpmCache}"`,
  {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }
).trim();
fs.rmSync(tmpNpmCache, { recursive: true, force: true });
const tgzName = packOutput.split(/\r?\n/).pop().trim();
const tgzPath = path.join(DIST_DIR, tgzName);
if (!fs.existsSync(tgzPath)) {
  throw new Error(`Expected tarball not found: ${tgzPath}`);
}

// 3. Build cross-platform zip archive
const zipName = `Agent-EnvShare-v${version}.zip`;
const zipPath = path.join(DIST_DIR, zipName);
console.log(`Creating ${zipName}...`);
if (process.platform === 'win32') {
  execSync(
    `powershell -NoProfile -Command "$ProgressPreference = 'SilentlyContinue'; Compress-Archive -Path '${stageDir}' -DestinationPath '${zipPath}' -Force"`,
    { stdio: 'inherit' }
  );
} else {
  execSync(`zip -r "${zipPath}" "${stageName}"`, {
    cwd: DIST_DIR,
    stdio: 'inherit',
  });
}

// Clean staging folder so dist/ only holds release artifacts
fs.rmSync(stageDir, { recursive: true, force: true });

// 4. Write SHA256SUMS.txt
const artifacts = [tgzName, zipName];
const sums = artifacts.map((name) => `${sha256File(path.join(DIST_DIR, name))}  ${name}`);
const sumsPath = path.join(DIST_DIR, 'SHA256SUMS.txt');
fs.writeFileSync(sumsPath, `${sums.join('\n')}\n`, 'utf8');

console.log('\n=== Release Build Complete ===');
for (const name of [...artifacts, 'SHA256SUMS.txt']) {
  const full = path.join(DIST_DIR, name);
  const sizeKb = (fs.statSync(full).size / 1024).toFixed(1);
  console.log(`  - ${name} (${sizeKb} KB)`);
}
