---
name: machine-env
description: >-
  Use this skill whenever a task involves discovering, reusing, troubleshooting,
  registering, or creating machine-level shared environments on this computer —
  including base dev toolchains, ComfyUI / image generation, speech-to-text (STT /
  Whisper / FunASR) or TTS, local LLMs, reverse engineering (Frida / IDA / JADX /
  Ghidra / Apktool), Android development (Android SDK / NDK / ADB / Gradle), or
  shared model caches. Always consult the shared environment registry via `envreg`
  before installing heavy tools or environments, and register any newly created
  shared environment so all sessions, workspaces, and AI agents share it.
---

# Machine Shared Environment Governance (`envreg`)

This machine maintains a single source of truth for **shared, machine-singleton environments** so that all sessions, workspaces, and AI agents (Antigravity, Codex, dsh, Claude Code, Cursor, Gemini CLI, Windsurf, OpenCode, etc.) reuse existing heavy setups instead of installing duplicates.

- **CLI tool**: `envreg` (global command on `PATH`)
- **Active registry & policy**: run `envreg status` or `envreg policy`

---

## 1. Mandatory Rule: Check Before Using or Installing

Before installing or running any heavy tool, model, SDK, or local service (ComfyUI, Whisper/STT, Android SDK/ADB, Frida/JADX/IDA, CUDA/Conda toolchains, Ollama, etc.):

```bash
envreg list
# or narrow down:
envreg search <keyword>
envreg get <id> --json
```

- If a matching environment exists, **reuse its recorded `root_path`, `executables`, `env_vars`, `shared_resources`, or `service.url`**.
- **Do NOT** re-clone ComfyUI, re-download large model weights, or install duplicate SDKs/toolchains inside a business workspace.

---

## 2. Boundary: Shared vs. Project-Local

- **Must be shared (`machine-singleton`)**:
  - Large footprint (typically > 500 MB) or includes model weights / SDKs / system binaries
  - Requires GPU/CUDA or runs as a local service (ComfyUI, STT/TTS, Ollama)
  - System-level toolchains reused across projects (Android SDK/NDK, reverse engineering kits, shared runtimes/caches)
- **Keep project-local (do NOT register)**:
  - Lightweight per-project `.venv`, `node_modules`, or throwaway experiment folders

---

## 3. SOP: Creating a New Shared Environment

When `envreg list` confirms no reusable environment exists and you must create a new shared one:

1. **Plan & deduplicate first** (required):
   ```bash
   envreg plan --category <category> --name "<Readable Name>"
   ```
   Supported categories: `dev`, `ai-image`, `ai-audio`, `ai-llm`, `reverse`, `android`, `shared-models`, `other`.
2. **Install at the recommended shared root path** returned by `envreg plan` (never inside a business repo, `Desktop`, `Downloads`, or `Temp`, unless the user explicitly overrides the location).
3. **Verify it actually works** (run a minimal version/import/health command).
4. **Register immediately so all other agents see it**:
   - Via CLI flags:
     ```bash
     envreg register \
       --id <kebab-case-id> \
       --name "<Readable Name>" \
       --category <category> \
       --root "<AbsoluteRootPath>" \
       --summary "<One-line purpose>" \
       --exec python="<AbsolutePythonPath>" \
       --resource "<SharedModelsOrCachePath>" \
       --start-cmd "<OptionalStartCommand>" \
       --url "<OptionalServiceUrl>" \
       --port <OptionalPort> \
       --use "<How to invoke / avoid pitfalls>" \
       --check-path "<KeyFileOrDir>" \
       --check-cmd "<OptionalQuickHealthCommand>" \
       --tag "<tag1,tag2>" \
       --updated-by "<your-agent-name>"
     ```
   - Or via JSON file / stdin (`envreg register --file <spec.json>` or `--stdin`).
5. **Confirm registration**:
   ```bash
   envreg doctor <id>
   ```
   A shared environment creation task is **not complete** until `envreg register` succeeds.

---

## 4. SOP: Registering an Already-Existing Environment

For environments that already exist on disk:
- **Register in-place** — do NOT move existing working installations unless the user explicitly asks to migrate them.
- Inspect the directory to capture accurate `root_path`, key `executables`, `env_vars`, `shared_resources`, `service` details, and a reliable `health_check`, then call `envreg register`.

---

## 5. Maintenance Commands

- Check health of all registered environments: `envreg doctor` (or `envreg doctor --fix-status`)
- Update an existing entry: `envreg update <id> --notes "..."`
- Refresh `INDEX.md` and sync all detected agent rule blocks: `envreg sync`
- View integration status across installed agents: `envreg status`
- View or change the default shared root for new environments: `envreg policy` / `envreg policy --set-root "<NewRoot>"`
