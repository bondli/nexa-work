# Nexa Desktop 桌面端

Nexa 智能工作助手桌面应用，基于 Electron + React，支持自由任务 / 项目编码、知识库、记忆、定时任务，并通过中继服务与手机端协同。

## 技术栈

- Electron 32（主进程 / 预加载）
- React 19 + Vite（electron-vite）
- Tailwind CSS 4 + shadcn/ui (new-york) + Lucide 图标
- sql.js（WASM，纯前端 SQLite，避免原生模块 ABI 问题）
- @earendil-works/pi-agent-core（Agent Runtime）
- Zustand（状态管理）

## 目录结构

```
nexa-desktop/
├── src/
│   ├── main/          # 主进程（Node 环境）
│   │   ├── index.ts              # 入口、窗口、IPC 注册、RelayClient 装配
│   │   ├── agent/                # runtime、工具、记忆引擎、知识库工具、settings
│   │   ├── connectors/           # 连接器（HTTP 调用、凭据加密）
│   │   ├── db/                   # sql.js 数据库封装
│   │   ├── experts/ skills/      # 专家 / 技能包注册
│   │   ├── knowledge/            # 知识库服务
│   │   ├── relay/                # 中继客户端（device.ts、relay-client.ts）
│   │   └── scheduler/            # 定时任务（cron 轮询、子进程执行）
│   ├── preload/        # 预加载脚本（必须输出 .cjs，contextBridge 暴露 window.nexa）
│   ├── renderer/       # 渲染进程（React UI）
│   │   ├── components/          # 通用组件、设置对话框、手机配对 Tab
│   │   ├── features/            # 聊天、侧边栏、定时任务、技能包、产物面板
│   │   └── stores/              # Zustand 状态
│   └── shared/         # 主/渲染共享类型与 IPC 通道常量
├── electron.vite.config.ts
├── tsconfig.json / tsconfig.node.json / tsconfig.web.json
└── package.json
```

## 本地开发

```bash
npm install
npm run dev
```

`npm run dev` 默认开启 9222 端口远程调试（`REMOTE_DEBUGGING_PORT=9222`），可通过 CDP 连接。修改主进程 / preload 后需要手动重启 dev（electron-vite 不会自动重载主进程）。

> 打包后的应用不支持远程调试，仅开发态可用。

## 常用脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | 启动开发模式 |
| `npm run typecheck` | 主进程 + 渲染进程全量类型检查（`typecheck:node` + `typecheck:web`） |
| `npm run build` | electron-vite 构建产物到 `out/` |
| `npm run pack` | 构建并打包为 `.app`（mac，--dir 不生成 dmg） |
| `npm run dist` | 构建并生成安装包（mac arm64 + x64 dmg 到 `release/`） |

## 数据与配置位置

所有用户数据位于 `~/.nexa/`：

| 文件 / 目录 | 说明 |
|---|---|
| `settings.json` | 全局配置：默认模型、API Keys、`relayUrl` |
| `nexa.db` | sql.js SQLite 数据库（会话、消息、知识库、笔记、定时任务、job_runs） |
| `device.json` | 本机设备身份 `{deviceId, name}` |
| `relay-state.json` | 已配对手机缓存（仅 deviceId/name/pairedAt，不存 token） |
| `connectors/*.yaml` | 连接器配置（headers 支持 `${secret:key}` 解密注入） |
| `.secret` | 连接器主密钥（AES-256-GCM，0600 权限） |
| `experts/*.yaml` | 用户自定义专家 |
| `skills/<id>/skill.yaml` + `.state.json` | 技能包定义与启用状态 |
| `main.log` | 主进程日志（flog） |

> 数据库采用 `DELETE` 日志模式；sql.js 为内存库，修改通过导出二进制 buffer 落盘。**外部进程直接读写 nexa.db 不会被运行中的应用感知**。

## 中继服务配置（手机配对）

桌面端通过设置 → **手机配对** Tab 配置：

1. 填写中继服务器地址（如 `http://127.0.0.1:8787` 或 `https://relay.example.com`），点击"保存并连接"
2. 点击"生成配对码"获取 6 位码 + 二维码（`nexa://pair?url=&code=`）
3. 手机端扫码或输码完成配对；已配对设备显示在线状态，可解绑

中继地址存 HTTP(S) 基址，客户端内部推导 `/ws` 的 WS URL；桌面端断线后按 `1s/2s/5s/10s/30s` 退避重连。

## 打包（electron-builder）

macOS 产物：`release/Nexa-<version>-arm64.dmg` 与 `release/Nexa-<version>.dmg`。

关键配置（见 `package.json`）：
- `appId`: `com.nexa.desktop`
- `asarUnpack` + `extraResources` 同时处理 `sql.js/dist/sql-wasm.wasm`，保证生产环境能加载 WASM
- 输出目录 `release/`（已 gitignore）

## 关键工程约束

- **preload 必须输出 `.cjs`**（`"type":"module"` 下 ESM 在 require 加载时会失败）
- **生产环境 `contextIsolation: true`、`nodeIntegration: false`**，所有主进程能力通过 `contextBridge` 以 `window.nexa.*` 暴露
- **数据库用 sql.js WASM，不使用 better-sqlite3**（macOS 上原生模块与 Electron 32 ABI 不兼容，会 SIGSEGV）
- **pi-agent-core 工具失败必须 throw**：`executeTool` 仅以抛出异常判定 `isError`
- **spawn Node 子进程必须设 `ELECTRON_RUN_AS_NODE=1`**，否则 Electron 二进制会把脚本当 app 加载
- 会话创建需延迟启动 Agent Loop，确保 IPC 响应先返回，避免首条消息丢失
- 前端组件：Lucide 图标（禁用 emoji / 手写 SVG）、4px 间距基线、所有可交互组件必须有 hover 与 focus-visible 状态

## 排查

- 主进程日志：`tail -f ~/.nexa/main.log`
- 类型检查失败先跑 `npm run typecheck` 定位主进程/渲染进程
- 中继连接状态：设置 → 手机配对 Tab 查看徽标；或主进程日志中搜索 `relay`
