# Nexa

> Nexa 智能工作助手 —— 桌面优先的 AI 工作台，多端协同。

Nexa 是一套以 **Electron 桌面端为核心** 的 AI 工作助手产品：内置 pi coding agent，支持自由任务与项目编码两种工作模式，提供知识库、三层记忆引擎、定时任务、技能包（Skills / 专家 / 连接器）等能力；并通过云端中继服务与 **Android 手机端**、**Chrome 浏览器插件** 协同，实现随时随地采集资料、下发任务、接收通知。

## 目录结构

| 目录 | 说明 | 技术栈 |
|---|---|---|
| `nexa-desktop/` | 桌面端主应用（产品主体）：主进程承载 Agent Runtime、SQLite、知识库、记忆引擎、调度器、技能包、连接器与中继客户端；渲染进程为 React 界面 | Electron 32 · React 19 · shadcn/ui · sql.js · pi-agent-core |
| `nexa-relay/` | 云端中继服务：桌面端与手机端 / 浏览器插件之间的 WebSocket 配对、鉴权与消息路由，配对数据 JSON 文件持久化 | Node 18+ · Express · ws · PM2 |
| `nexa-mobile/` | 手机端（v1 仅 Android）：扫码配对、会话列表、轻量对话、资料库搜索 | Expo 57 · React Native 0.86 · expo-router · zustand |
| `nexa-extension/` | Chrome 浏览器插件（MV3）：右键收藏图片、页面采集、资料库搜索，经中继单播路由到桌面端 | TypeScript · esbuild · Chrome MV3 |
| `nexa-shared/` | 三端共享协议包：中继消息类型、会话 / 知识库 / 记忆数据结构、编解码与校验工具、常量与提示词模板 | TypeScript（源码直引） |
| `demo/` | 高保真交互原型（单文件 HTML），桌面端 UI 的对齐基准 | HTML / CSS / JS |
| `docs/` | 产品与技术设计文档、coding agent 调研、架构图（`architecture.html`） | Markdown / HTML |

## 整体架构

![Nexa 系统架构总览](docs/architecture.html)

> 用浏览器打开 [docs/architecture.html](docs/architecture.html) 查看完整架构图。

数据流概览：

- **手机端 / Chrome 插件** 通过配对码换取 token，经 WSS 连接云端中继；
- **中继** 完成设备配对、心跳保活与单播路由，把 RPC 请求转发给桌面端主进程，并把 Agent 事件、定时任务通知回流给各端；
- **桌面端主进程** 是系统核心：运行 pi coding agent（Agent Loop、工具调用），管理 SQLite 本地库（会话、消息、知识库、三层记忆、定时任务、技能、连接器），并通过中继客户端维持长连接；
- **渲染进程** 通过 IPC 与主进程通信，提供任务（自由任务 / 项目编码）、定时任务、资料库、技能包、设置等页面；
- **模型服务** 支持 DeepSeek / OpenAI / Anthropic，API Key 与自定义 Base URL 配置于 `~/.nexa/settings.json`。

## 快速开始

### 桌面端（主体）

```bash
cd nexa-desktop
npm install
npm run dev        # 开发模式（带远程调试端口 9222）
npm run typecheck  # 类型检查
npm run dist       # 打包 macOS 应用
```

首次启动会弹出三步引导（用户名 → 模型配置 → 偏好）。API Key 也可手动写入 `~/.nexa/settings.json`：

```json
{ "apiKeys": { "deepseek": "sk-..." } }
```

### 中继服务

```bash
cd nexa-relay
npm install
npm start          # 默认端口见 src/index.js
pm2 start ecosystem.config.cjs  # 生产部署
```

### 手机端

```bash
cd nexa-mobile
npm install
npx expo start     # EAS 构建 Android 见 eas.json
```

### 浏览器插件

```bash
cd nexa-extension
npm install
npm run build      # 产物输出到 dist/（开发可用 npm run dev 监听构建）
```

Chrome → `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择 **`nexa-extension/dist/`** 目录。

## 设计约束（摘要）

- UI 严格使用 shadcn/ui new-york 主题 Neutral 色板，图标统一 Lucide，4px 间距基线；
- 所有页面为左右分栏结构，左侧导航栏宽 78px，内容避让 macOS 交通灯；
- Electron 生产环境 `contextIsolation: true`；预加载脚本输出 `.cjs`；
- SQLite 采用 sql.js（WASM）实现，规避原生模块 ABI 问题；连接器凭据 AES-256-GCM 加密存储于 `~/.nexa/`。

详细设计见 [docs/product-design.md](docs/product-design.md) 与 [docs/tech-design.md](docs/tech-design.md)；变更历史见 [CHANGELOG.md](CHANGELOG.md)。
