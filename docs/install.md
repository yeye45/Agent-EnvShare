# Installing `Agent-EnvShare` (`envreg`) — AI Agent & Human Guide

This guide is designed so **any AI coding agent** (Antigravity, Codex, dsh, Claude Code, Cursor, etc.) or human can install, initialize, and verify `Agent-EnvShare` (`envreg`) in a few commands.

- Repository: https://github.com/yeye45/Agent-EnvShare
- Releases: https://github.com/yeye45/Agent-EnvShare/releases

## Prerequisites

- **Node.js >= 20.0.0** (`node -v`)
- No third-party npm dependencies required.

---

## Step 1: Install `Agent-EnvShare` (`envreg`)

Choose whichever installation method fits your machine:

### Option 1: Clone from GitHub (recommended for AI agents)
```bash
git clone https://github.com/yeye45/Agent-EnvShare.git ~/.agent-envshare
cd ~/.agent-envshare
node bin/envreg.mjs setup
```

### Option 2: From npm tarball (`.tgz` from GitHub Releases)
```bash
npm install -g ./agent-envshare-1.0.0.tgz
```

### Option 3: From release `.zip` (`Agent-EnvShare-v1.0.0.zip`)
```bash
# After extracting Agent-EnvShare-v1.0.0.zip into <install-dir>:
cd <install-dir>
node bin/envreg.mjs setup
```
`setup` installs global CLI shims (`envreg` / `envreg.cmd` / `envreg.ps1`) automatically on Windows, macOS, and Linux.

---

## Step 2: Initialize Local Registry (Decoupled from Code)

Initialize the machine's registry directory (defaults to `~/.machine-env`) and choose where **new** shared environments should be created:

```bash
# Default registry (~/.machine-env) and default shared root (~/SharedEnvs)
envreg init

# Or specify custom locations (e.g. a large secondary drive on Windows):
envreg init --shared-root "D:\SharedEnvs"
# Or custom registry folder too:
envreg init --registry "D:\MyEnvRegistry" --shared-root "D:\SharedEnvs"
```

Configuration is saved in `~/.envreg.json` (can also be overridden per command via `SHARED_ENV_REGISTRY`).

---

## Step 3: Wire Up All Installed AI Agents

```bash
envreg setup
envreg status
```

What `envreg setup` does safely:
1. Symlinks/junctions `skill/machine-env/` into detected agent skill folders (`~/.agents/skills`, Antigravity plugin, `~/.codex/skills`, `~/.dsh/skills`, `~/.claude/skills`, `~/.cursor/skills`, etc.).
2. Appends/updates ONLY the managed block (`<!-- BEGIN MACHINE-ENV-REGISTRY --> ... <!-- END MACHINE-ENV-REGISTRY -->`) in detected global rule files (`AGENTS.md` / `CLAUDE.md` / `GEMINI.md`), backing up the original file to `*.envreg.bak` on first touch.

---

## Step 4: Register Existing Heavy Environments (In-Place)

Do **not** move existing working environments. Register them in-place so all agents immediately know about them:

```bash
envreg register \
  --id comfyui \
  --name "ComfyUI" \
  --category ai-image \
  --root "<existing-comfyui-path>" \
  --summary "Local shared ComfyUI environment" \
  --exec python="<comfyui-python-path>" \
  --url "http://127.0.0.1:8188" \
  --port 8188
```

Verify everything is healthy:
```bash
envreg doctor
envreg list
```

---

## Clean Uninstall (Agent Integrations Only)

To remove managed rule blocks and skill symlinks without touching your registry data or installed environments:
```bash
envreg uninstall
```
