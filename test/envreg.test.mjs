import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const BIN = path.join(REPO_ROOT, 'bin', 'envreg.mjs');

function runEnvreg(args, envOverrides = {}) {
  const env = {
    ...process.env,
    ...envOverrides,
  };
  delete env.SHARED_ENV_REGISTRY;
  if (envOverrides.SHARED_ENV_REGISTRY !== undefined) {
    env.SHARED_ENV_REGISTRY = envOverrides.SHARED_ENV_REGISTRY;
  }
  return execFileSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

describe('envreg release test suite', () => {
  let tmpRoot;
  let fakeHome;
  let fakeBin;
  let sampleEnvDir;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'envreg-test-'));
    fakeHome = path.join(tmpRoot, 'home');
    fakeBin = path.join(tmpRoot, 'bin');
    sampleEnvDir = path.join(tmpRoot, 'envs', 'my-comfyui');
    fs.mkdirSync(fakeHome, { recursive: true });
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.mkdirSync(sampleEnvDir, { recursive: true });
    fs.writeFileSync(path.join(sampleEnvDir, 'main.py'), '# dummy\n', 'utf8');
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('prints package version and initializes decoupled default registry', () => {
    const version = runEnvreg(['--version'], { ENVREG_HOME: fakeHome }).trim();
    assert.match(version, /^\d+\.\d+\.\d+$/);

    const sharedRoot = path.join(tmpRoot, 'SharedEnvs');
    const out = runEnvreg(['init', '--shared-root', sharedRoot, '--json'], {
      ENVREG_HOME: fakeHome,
    });
    const parsed = JSON.parse(out);
    assert.equal(parsed.registry_dir, path.join(fakeHome, '.machine-env'));
    assert.equal(parsed.default_shared_root, sharedRoot);
    assert.equal(fs.existsSync(parsed.policy_path), true);
    assert.equal(fs.existsSync(parsed.index_md), true);
  });

  it('supports full CRUD, conflict detection, plan warning, and doctor', () => {
    const baseEnv = { ENVREG_HOME: fakeHome };
    const sharedRoot = path.join(tmpRoot, 'SharedEnvs');
    runEnvreg(['init', '--shared-root', sharedRoot], baseEnv);

    // Register valid environment
    const regOut = runEnvreg(
      [
        'register',
        '--id',
        'comfyui',
        '--name',
        'ComfyUI Test',
        '--category',
        'ai-image',
        '--root',
        sampleEnvDir,
        '--summary',
        'Local image generation',
        '--check-path',
        path.join(sampleEnvDir, 'main.py'),
        '--check-cmd',
        'node -v',
        '--tag',
        'sd,flux',
        '--updated-by',
        'test-runner',
        '--no-sync',
        '--json',
      ],
      baseEnv
    );
    const reg = JSON.parse(regOut);
    assert.equal(reg.action, 'created');
    assert.equal(reg.record.id, 'comfyui');

    // Duplicate ID must fail
    assert.throws(() => {
      runEnvreg(
        [
          'register',
          '--id',
          'comfyui',
          '--name',
          'Dup',
          '--category',
          'ai-image',
          '--root',
          sampleEnvDir,
          '--summary',
          'Dup',
          '--no-sync',
        ],
        baseEnv
      );
    });

    // Duplicate path under different ID must fail
    assert.throws(() => {
      runEnvreg(
        [
          'register',
          '--id',
          'comfyui-2',
          '--name',
          'Dup Path',
          '--category',
          'ai-image',
          '--root',
          sampleEnvDir,
          '--summary',
          'Dup Path',
          '--no-sync',
        ],
        baseEnv
      );
    });

    // Plan warns about existing environment in same category
    const plan = JSON.parse(
      runEnvreg(['plan', '--category', 'ai-image', '--name', 'Another Gen', '--json'], baseEnv)
    );
    assert.equal(plan.existing_in_category_or_similar.length, 1);
    assert.equal(plan.existing_in_category_or_similar[0].id, 'comfyui');

    // Search & get
    const search = JSON.parse(runEnvreg(['search', 'flux', '--json'], baseEnv));
    assert.equal(search.count, 1);
    const fetched = JSON.parse(runEnvreg(['get', 'comfyui', '--json'], baseEnv));
    assert.equal(fetched.name, 'ComfyUI Test');

    // Doctor healthy check
    const docOk = JSON.parse(runEnvreg(['doctor', '--json'], baseEnv));
    assert.equal(docOk.healthy, 1);
    assert.equal(docOk.broken, 0);

    // Break health_check path and verify doctor --fix-status
    fs.unlinkSync(path.join(sampleEnvDir, 'main.py'));
    const docBroken = JSON.parse(runEnvreg(['doctor', '--fix-status', '--no-sync', '--json'], baseEnv));
    assert.equal(docBroken.broken, 1);
    assert.equal(docBroken.status_updated, 1);
    const afterBroken = JSON.parse(runEnvreg(['get', 'comfyui', '--json'], baseEnv));
    assert.equal(afterBroken.status, 'broken');

    // Update & remove
    runEnvreg(['update', 'comfyui', '--notes', 'needs repair', '--allow-missing', '--no-sync'], baseEnv);
    const updated = JSON.parse(runEnvreg(['get', 'comfyui', '--json'], baseEnv));
    assert.equal(updated.notes, 'needs repair');

    runEnvreg(['remove', 'comfyui', '--no-sync'], baseEnv);
    const listAfter = JSON.parse(runEnvreg(['list', '--json'], baseEnv));
    assert.equal(listAfter.count, 0);
  });

  it('sets up, syncs, preserves user rules, and cleanly uninstalls across multiple agents', () => {
    // Simulate installed agent directories
    fs.mkdirSync(path.join(fakeHome, '.gemini', 'config', 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.codex', 'skills'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.dsh', 'skills'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.claude', 'skills'), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, '.cursor', 'skills'), { recursive: true });

    const codexAgentsMd = path.join(fakeHome, '.codex', 'AGENTS.md');
    fs.writeFileSync(codexAgentsMd, '# My Custom Codex Rules\nKeep this untouched.\n', 'utf8');

    const baseEnv = {
      ENVREG_HOME: fakeHome,
      ENVREG_BIN_DIR: fakeBin,
    };

    runEnvreg(['init', '--shared-root', path.join(tmpRoot, 'SharedEnvs')], baseEnv);
    const setupReport = JSON.parse(runEnvreg(['setup', '--json'], baseEnv));
    assert.equal(setupReport.shim.ok, true);

    // Check backup created and user content preserved
    assert.equal(fs.existsSync(`${codexAgentsMd}.envreg.bak`), true);
    const codexAfterSetup = fs.readFileSync(codexAgentsMd, 'utf8');
    assert.match(codexAfterSetup, /# My Custom Codex Rules/);
    assert.match(codexAfterSetup, /BEGIN MACHINE-ENV-REGISTRY/);

    // Verify Antigravity plugin & dsh rule & skill links exist
    assert.equal(
      fs.existsSync(path.join(fakeHome, '.gemini', 'config', 'plugins', 'machine-env', 'plugin.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(fakeHome, '.dsh', 'skills', 'machine-env', 'SKILL.md')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(fakeHome, '.agents', 'skills', 'machine-env', 'SKILL.md')),
      true
    );

    // Register an environment and verify auto-sync updates Codex and dsh rules
    runEnvreg(
      [
        'register',
        '--id',
        'stt-whisper',
        '--name',
        'Whisper STT',
        '--category',
        'ai-audio',
        '--root',
        sampleEnvDir,
        '--summary',
        'Speech to text',
      ],
      baseEnv
    );
    const dshRules = fs.readFileSync(path.join(fakeHome, '.dsh', 'AGENTS.md'), 'utf8');
    assert.match(dshRules, /stt-whisper/);

    // Verify status shows detected & synced
    const status = JSON.parse(runEnvreg(['status', '--json'], baseEnv));
    const codexStatus = status.agents.find((a) => a.id === 'codex');
    assert.equal(codexStatus.detected, true);
    assert.equal(codexStatus.skill, 'linked');
    assert.equal(codexStatus.rule, 'synced');

    // Clean uninstall preserves original Codex rules & registry data
    runEnvreg(['uninstall', '--json'], baseEnv);
    const codexAfterUninstall = fs.readFileSync(codexAgentsMd, 'utf8');
    assert.match(codexAfterUninstall, /# My Custom Codex Rules/);
    assert.doesNotMatch(codexAfterUninstall, /BEGIN MACHINE-ENV-REGISTRY/);
    assert.equal(
      fs.existsSync(path.join(fakeHome, '.dsh', 'skills', 'machine-env')),
      false
    );
    // Registry data still intact
    const listStillThere = JSON.parse(runEnvreg(['list', '--json'], baseEnv));
    assert.equal(listStillThere.count, 1);
  });
});
