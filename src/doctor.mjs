import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { listEnvironments, saveEnvironment } from './store.mjs';

function probeTcpPort(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

export async function checkSingleEnvironment(env) {
  const issues = [];
  const details = {
    root_exists: false,
    executables: {},
    health_path_exists: null,
    health_command_ok: null,
    service_port_open: null,
  };

  details.root_exists = Boolean(env.root_path && fs.existsSync(env.root_path));
  if (!details.root_exists) {
    issues.push(`Root path missing: ${env.root_path}`);
  }

  for (const [name, exePath] of Object.entries(env.executables || {})) {
    if (path.isAbsolute(exePath)) {
      const ok = fs.existsSync(exePath);
      details.executables[name] = ok;
      if (!ok) {
        issues.push(`Executable missing (${name}): ${exePath}`);
      }
    } else {
      details.executables[name] = 'relative/PATH';
    }
  }

  if (env.health_check?.path) {
    details.health_path_exists = fs.existsSync(env.health_check.path);
    if (!details.health_path_exists) {
      issues.push(`Health check path missing: ${env.health_check.path}`);
    }
  }

  if (env.health_check?.command) {
    try {
      execSync(env.health_check.command, {
        stdio: 'pipe',
        timeout: 15_000,
        windowsHide: true,
      });
      details.health_command_ok = true;
    } catch (err) {
      details.health_command_ok = false;
      issues.push(`Health check command failed: ${env.health_check.command} (${err.message.split('\n')[0]})`);
    }
  }

  if (typeof env.service?.port === 'number' && env.service.port > 0) {
    details.service_port_open = await probeTcpPort(env.service.port);
  }

  const healthy = issues.length === 0;
  return {
    id: env.id,
    name: env.name,
    category: env.category,
    recorded_status: env.status,
    healthy,
    issues,
    details,
  };
}

export async function runDoctor({ id, fixStatus = false } = {}) {
  const envs = id
    ? listEnvironments().filter((e) => e.id === id)
    : listEnvironments();

  if (id && envs.length === 0) {
    throw new Error(`Environment not found: ${id}`);
  }

  const results = [];
  let statusUpdated = 0;

  for (const env of envs) {
    const res = await checkSingleEnvironment(env);
    if (fixStatus && env.status !== 'deprecated') {
      const targetStatus = res.healthy ? 'active' : 'broken';
      if (env.status !== targetStatus) {
        saveEnvironment(
          { ...env, status: targetStatus },
          { isUpdate: true, allowMissing: true }
        );
        res.status_changed = `${env.status} -> ${targetStatus}`;
        statusUpdated += 1;
      }
    }
    results.push(res);
  }

  return {
    checked: results.length,
    healthy: results.filter((r) => r.healthy).length,
    broken: results.filter((r) => !r.healthy).length,
    status_updated: statusUpdated,
    results,
  };
}
