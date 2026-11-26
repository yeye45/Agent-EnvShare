# Environment Schema & Registry Layout

## Registry Directory Layout

Default location: `~/.machine-env` (or custom path recorded in `~/.envreg.json`, or `SHARED_ENV_REGISTRY` env var).

```text
<registry_dir>/
├── policy.json               # Categories, default_shared_root, naming & guardrails
├── INDEX.md                  # Auto-generated compact markdown summary
└── environments/
    ├── _template.json        # Ignored template reference (files starting with _ are ignored)
    ├── comfyui.json
    ├── stt-whisper.json
    └── android-sdk.json
```

## Environment Record Schema (`environments/<id>.json`)

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | Yes | Unique kebab-case identifier (`/^[a-z0-9][a-z0-9-]{1,47}$/`) |
| `name` | `string` | Yes | Human-readable display name |
| `category` | `string` | Yes | One of the keys defined in `policy.json` (`dev`, `ai-image`, `ai-audio`, `ai-llm`, `reverse`, `android`, `shared-models`, `other`) |
| `scope` | `string` | No | `machine-singleton` (default) or `machine-shared` |
| `status` | `string` | No | `active` (default), `inactive`, `broken`, or `deprecated` |
| `summary` | `string` | Yes | One-line purpose description |
| `root_path` | `string` | Yes | Absolute path to the environment root directory |
| `executables` | `Record<string, string>` | No | Key executable paths (e.g. `python`, `adb`, `frida`) |
| `env_vars` | `Record<string, string>` | No | Important environment variables (e.g. `ANDROID_HOME`, `HF_HOME`) |
| `shared_resources` | `string[]` | No | Shared model directories or caches |
| `service` | `object` | No | `{ start_command, url, port }` for local server environments |
| `how_to_use` | `string[]` | No | Concise invocation tips and guardrails |
| `health_check` | `object` | No | `{ path, command }` verified by `envreg doctor` |
| `tags` | `string[]` | No | Extra keywords for `envreg search` |
| `notes` | `string` | No | Pitfalls, CUDA/driver requirements, or maintenance notes |
| `created_at` / `updated_at` | `string` | Auto | ISO-8601 timestamps |
| `updated_by` | `string` | Auto | Agent or user identifier |

## Environment Variables

- `SHARED_ENV_REGISTRY`: Override registry directory for a single invocation.
- `ENVREG_HOME`: Override home directory (useful for isolated testing or portable setups).
- `ENVREG_BIN_DIR`: Override global CLI shim installation directory.
- `ENVREG_AGENT`: Default value for `updated_by` when registering environments.
- `DSH_HOME`: DeepSeek Harness home directory (defaults to `~/.dsh`).
