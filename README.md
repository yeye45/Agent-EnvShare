# Agent-EnvShare (`envreg`)

> **Stop AI agents from reinstalling ComfyUI, Whisper, Android SDK, and Frida in every workspace.**  
> 零依赖、跨平台（Windows / macOS / Linux），让 Antigravity、Codex、dsh（DeepSeek Harness）、Claude Code、Cursor 等所有 Agent 共享同一份本机重型环境清单，并规范新共享环境的创建与自动同步。

---

## 为什么需要 `envreg`？

在本地开发机上，我们通常只装一份重型/单例环境：
- **AI 生图**：ComfyUI、SD WebUI、Flux 共享模型库
- **语音处理**：Whisper / Faster-Whisper / FunASR / SenseVoice / TTS
- **本地大模型**：Ollama、llama.cpp、HuggingFace/ModelScope 公共缓存
- **逆向分析**：Frida、JADX、Apktool、IDA / Ghidra、Mitmproxy
- **安卓开发**：Android SDK / NDK / ADB / Gradle 缓存 / Scrcpy
- **基础工具链**：CUDA、多版本运行时、公共虚拟环境

但只要换个会话、换个工作区、或从 Codex 切到 Antigravity / dsh / Claude Code，AI 往往“失忆”，动辄在新项目里重新 `pip install` 或重新拉一套几十 GB 的环境。

`envreg` 借鉴 Agent-Reach 的极简跨 Agent 思路：
1. **代码与本机数据彻底分离**：工具本身可公开发布；你的本机环境清单存放在用户目录（默认 `~/.machine-env`，可自定义），绝不混入开源仓库。
2. **零第三方依赖纯 Node.js CLI**：冷启动快、跨 Windows / macOS / Linux、不受 Python 虚拟环境切换干扰。
3. **一次 `setup`，全机 Agent 接入**：
   - 将唯一一份 `skill/machine-env/SKILL.md` 软链/联接到所有已检测到的 Agent 技能目录；
   - 在各 Agent 全局规则文件中仅维护一段注释受管区块（`<!-- BEGIN MACHINE-ENV-REGISTRY --> ... <!-- END MACHINE-ENV-REGISTRY -->`），绝不覆盖你原有的规则（首次修改自动备份 `.envreg.bak`）；
   - **任意 Agent 调用 `envreg register` 新建环境后，自动刷新 `INDEX.md` 并同步给其余所有 Agent**。

---

## 已适配 Agent

`envreg setup` 会自动探测本机已安装的 Agent 并接入：

- **Antigravity**（原生全局 Plugin：`~/.gemini/config/plugins/machine-env/`）
- **OpenAI Codex**（`~/.codex/skills` + `~/.codex/AGENTS.md`）
- **DeepSeek Harness (`dsh`)**（`$DSH_HOME/skills` + `$DSH_HOME/AGENTS.md`）
- **Claude Code**（`~/.claude/skills` + `~/.claude/CLAUDE.md`）
- **Cursor**（`~/.cursor/skills`）
- **Open Agent Skills 公共根目录**（`~/.agents/skills`）
- **Gemini CLI / Windsurf / OpenCode**（检测到即自动接入）
- **任意其他 CLI Agent**：直接通过全局 `envreg` 命令 + `INDEX.md` 使用，零协议门槛。

---

## 快速安装

### 方式 A：直接交给你的 AI Agent 自动安装（推荐）

直接把下面这句话发给任意 AI Agent（Antigravity / Codex / dsh / Claude Code 等）：

```text
帮我安装并配置 Agent-EnvShare：https://raw.githubusercontent.com/yeye45/Agent-EnvShare/main/docs/install.md
```

### 方式 B：从发布包或 GitHub 源码手动安装（需要 Node.js >= 20）

**从 GitHub 源码安装：**
```bash
git clone https://github.com/yeye45/Agent-EnvShare.git
cd Agent-EnvShare
node bin/envreg.mjs init --shared-root /path/to/SharedEnvs
node bin/envreg.mjs setup
envreg status
```

**从 GitHub Release `.tgz` 安装：**
```bash
npm install -g ./agent-envshare-1.0.0.tgz
envreg init --shared-root /path/to/SharedEnvs
envreg setup
envreg status
```

**从 GitHub Release `.zip` 安装：**
```bash
# 解压 Agent-EnvShare-v1.0.0.zip 后进入目录
node bin/envreg.mjs init --shared-root /path/to/SharedEnvs
node bin/envreg.mjs setup
envreg status
```

> 默认本机注册表数据位于 `~/.machine-env`；如需指定其他位置（例如单独同步/备份目录），运行：
> `envreg init --registry /your/custom/registry --shared-root /your/SharedEnvs`

---

## 日常使用

```bash
# 查看已登记的共享环境 / 按关键词检索 / 查看详情
envreg list
envreg search comfyui
envreg get comfyui

# 新建共享环境前查重 + 获取推荐标准目录
envreg plan --category ai-audio --name "Faster-Whisper STT"

# 登记已有或新建的共享环境（自动校验路径、刷新 INDEX.md 并同步所有 Agent）
envreg register \
  --id comfyui \
  --name "ComfyUI Image Gen" \
  --category ai-image \
  --root "/path/to/ComfyUI" \
  --summary "本机共享 ComfyUI 生图与 API 服务" \
  --exec python="/path/to/ComfyUI/venv/bin/python" \
  --url "http://127.0.0.1:8188" \
  --port 8188

# 批量体检（验证路径、可执行文件、健康探针命令、服务端口）
envreg doctor
envreg doctor --fix-status

# 查看或修改默认新建目录策略
envreg policy
envreg policy --set-root "/new/SharedEnvs"

# 电脑新装了其他 Agent 后重新扫描接入
envreg setup

# 卸载各 Agent 接入（不删除你的注册表数据和物理环境）
envreg uninstall
```

---

## 开发与打包发布

```bash
# 运行自动化测试（隔离临时 HOME 与注册表，不碰真实配置）
npm test

# 构建发布产物到 dist/（.tgz + .zip + SHA256SUMS.txt）
npm run release:build
```

更多字段规范见 [docs/schema.md](./docs/schema.md)，版本记录见 [CHANGELOG.md](./CHANGELOG.md)。

## License

[MIT](./LICENSE)
