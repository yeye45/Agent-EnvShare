# Changelog

All notable changes to `envreg` will be documented in this file.

## [1.0.0] - 2026-11-26

### Added
- **Zero-dependency cross-platform CLI (`envreg`)** supporting Windows, macOS, and Linux (Node.js >= 20).
- **Decoupled code & local data**: registry defaults to `~/.machine-env` (configurable via `envreg init --registry <dir>` or `SHARED_ENV_REGISTRY`).
- **Core commands**: `init`, `list`, `search`, `get`, `plan`, `register`, `update`, `remove`, `doctor`, `setup`, `sync`, `policy`, `status`, `uninstall`, `version`.
- **Single Source of Truth (SSOT)**: one JSON file per environment with atomic writes, cross-process lockfile, schema validation, path-conflict detection, and auto-generated `INDEX.md`.
- **Multi-agent auto-integration (`envreg setup`)**:
  - Open Agent Skills root (`~/.agents/skills/machine-env`)
  - Antigravity (native global plugin at `~/.gemini/config/plugins/machine-env`)
  - OpenAI Codex (`~/.codex/skills` + `~/.codex/AGENTS.md` managed block)
  - DeepSeek Harness / `dsh` (`$DSH_HOME/skills` + `$DSH_HOME/AGENTS.md` managed block)
  - Claude Code (`~/.claude/skills` + `~/.claude/CLAUDE.md` managed block)
  - Cursor, Gemini CLI, Windsurf, OpenCode (auto-detected when installed)
- **Safe managed-block syncing**: preserves existing user rules with `.envreg.bak` first-touch backup and clean removal via `envreg uninstall`.
- **AI-friendly installer guide**: `docs/install.md` enabling any coding agent to install and configure `envreg` automatically.
- **Automated test suite (`npm test`) and release packager (`npm run release:build`)**.
