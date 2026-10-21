# AGENTS.md

> 本文件面向 AI Coding Agent，遵循 **C.A.R.S** 框架（Commands / Architecture / Restrictions / Standards），用于让后续改动更准确、更少返工。
>
> 适用仓库：`nexa-work` —— 桌面优先的 AI 工作台 monorepo，含 5 个独立子项目 + 原型/文档目录。**每个子项目独立安装依赖、独立执行命令**，根目录没有 workspace。

---

## 1. Commands（开发命令）

> 根目录**没有** `package.json`，不存在根级脚本。所有命令必须在对应子目录下执行。
> 以下命令**逐字取自各子项目 `package.json`**，未配置的类别一律标注「未配置」，禁止臆造。

### nexa-desktop（桌面端主体，Electron）

```bash
cd nexa-desktop
npm install
npm run dev        # 开发模式；注入 REMOTE_DEBUGGING_PORT=9222 / ALLOW_ORIGINS=*
npm run build      # electron-vite build（产出 out/main、out/preload、out/renderer）
npm run preview    # electron-vite preview
npm run typecheck  # = typecheck:node && typecheck:web（唯一质量门禁）
npm run pack       # build + electron-builder --mac --win（一次产出 mac arm64 dmg + Windows x64 NSIS 安装包，均免签名）
npm run dist       # build + electron-builder --mac（仅 mac arm64 dmg）
```

- 细分类型检查：`npm run typecheck:node`（主进程/preload/共享）、`npm run typecheck:web`（渲染端）
- Lint：**未配置**（无 ESLint / Prettier）。统一以 `npm run typecheck` 作为静态检查门禁。
- Test：**未配置**（无 vitest/jest）。改完必须靠 `typecheck` + 真机运行验证。
- Format：**未配置**。遵循仓库既有风格（2 空格缩进、无分号）。

### nexa-relay（中继服务，Node）

```bash
cd nexa-relay
npm install
npm run build      # tsc 编译到 dist/
npm start          # = build + node dist/index.js（PORT 默认 8787）
npm run dev        # tsc --watch & node --watch dist/index.js
npm run typecheck  # tsc --noEmit
```

- 生产部署：`pm2 start ecosystem.config.cjs`
- Lint / Test / Format：**未配置**

### nexa-extension（Chrome MV3 插件）

```bash
cd nexa-extension
npm install
npm run build      # node scripts/build.mjs → 产物输出 dist/（加载已解压扩展用这个目录）
npm run dev        # node scripts/build.mjs --watch（仅 esbuild 部分监听，Vite 一次性构建）
npm run typecheck  # tsc --noEmit
```

- Lint / Test / Format：**未配置**

### nexa-mobile（手机端，Expo / React Native）

```bash
cd nexa-mobile
npm install
npm start                       # expo start
npm run android                 # expo run:android
npm run ios                     # expo run:ios
npm run web                     # expo start --web
npm run prebuild:android        # expo prebuild --platform android
npm run build:android           # prebuild + gradlew assembleRelease
npm run build:android-debug     # prebuild + gradlew assembleDebug
npm run typecheck               # tsc --noEmit
```

- Lint / Test / Format：**未配置**

### nexa-shared（三端共享协议包）

```bash
cd nexa-shared
npm install
npm run typecheck  # tsc --noEmit
```

- 只有 `typecheck`。**没有 build / dev / test / lint** —— 该包通过 `exports` 直引 `src/*.ts` 源码，由各消费端（electron-vite / Vite / tsconfig paths）自行编译，**不要为它新增构建步骤**。

---

## 2. Architecture（架构与目录）

### 2.1 技术栈版本（务必按此对齐，勿降级/替换）

| 子项目 | 技术栈 |
|---|---|
| `nexa-desktop` | Electron **32.3** · electron-vite **2.3** · Vite **5.4** · React **19.0** · TypeScript **5.7** · Tailwind CSS **v4**（`@tailwindcss/vite`） · shadcn/ui **new-york / neutral** · Radix UI · zustand **5** · react-markdown **9** + remark-gfm **4** · sql.js **1.14**（WASM） · ws **8** · lucide-react **0.544** |
| `nexa-relay` | Node **≥18** · TypeScript **5.6** · Express **4.21** · ws **8.18** · PM2（`ecosystem.config.cjs`） |
| `nexa-mobile` | Expo **57** · React Native **0.86** · expo-router **57**（typed routes） · React **19.2** · zustand **5** · TypeScript **6.0** |
| `nexa-extension` | Chrome **MV3**（`minimum_chrome_version 110`） · TypeScript **5.6** · esbuild **0.24**（background/options） + Vite **5**（popup/notes React 页面） · React **19** · Tailwind **3.4** · lucide-react |
| `nexa-shared` | 纯 TypeScript **5.9**，源码直引（无构建产物） |

Agent 能力依赖：`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`（版本 **0.74.x**），封装在 `nexa-desktop/src/main/agent/`。

### 2.2 系统数据流

```
手机端 / Chrome 插件 ──(配对码换 token)──> WSS 云端中继 ──单播路由──> 桌面端主进程
                                              ▲                          │
                                              └──── Agent 事件 / 通知回流 ─┘
桌面端主进程（系统核心）：Agent Runtime + SQLite(sql.js) + 知识库 + 记忆引擎 + 调度器 + 技能包 + 连接器
        │ IPC（contextIsolation，preload 输出 .cjs）
桌面端渲染进程：React 界面（window.nexa.* 是唯一对外通道）
```

### 2.3 目录结构（带注释）

```
nexa-work/
├── AGENTS.md                  # 本文件（AI 协作规范）
├── README.md                  # 产品与各端总览
├── CHANGELOG.md               # Keep a Changelog 格式，改动记入 [Unreleased]
├── .npmrc                     # registry=https://registry.npmmirror.com/
├── docs/                      # 产品/技术设计文档；architecture.html 为架构图
├── demo/                      # 高保真单文件 HTML 原型（桌面端 UI 的对齐基准）
│
├── nexa-desktop/              # ★ 产品主体
│   ├── electron.vite.config.ts    # 三段式构建：main / preload / renderer；定义路径别名
│   ├── components.json            # shadcn 配置（style=new-york, baseColor=neutral, iconLibrary=lucide）
│   ├── tsconfig.node.json         # 主进程 + preload + shared 的类型范围
│   ├── tsconfig.web.json          # 渲染端类型范围 + @renderer 别名
│   ├── assets/                    # icon.icns / icon.ico（打包图标）
│   └── src/
│       ├── main/                  # 主进程（Node 环境，唯一能做 IO/DB/网络的层）
│       │   ├── index.ts           # 入口：创建窗口、注册全部 ipcMain.handle、生命周期
│       │   ├── agent/             # Agent 运行时与工具
│       │   │   ├── runtime.ts             # Agent Loop、事件推送（message.assistant.done 等）
│       │   │   ├── settings.ts            # 模型解析 resolveModel、settings 读写
│       │   │   ├── tools.ts               # 工具注册
│       │   │   ├── kb-tools.ts            # 知识库工具
│       │   │   ├── memory-engine.ts/.ts   # 三层记忆引擎 + 记忆工具
│       │   │   ├── skill-tool.ts          # 技能调用工具
│       │   │   ├── connector-tool.ts      # 连接器工具
│       │   │   ├── schedule-tools.ts      # 定时任务工具
│       │   │   └── llm-helper.ts          # 低层 LLM 调用封装（如生成标题）
│       │   ├── db/                # SQLite（sql.js WASM）
│       │   │   ├── database.ts            # 全部 DAO（session / message / toolCall / agentRun ...）
│       │   │   └── types.ts               # 表结构 TS 类型（Message.token_usage 等字段源头）
│       │   ├── knowledge/service.ts       # 资料库服务（笔记 note* / 知识库 kb*）
│       │   ├── skills/            # 技能包注册表：builtin.ts / registry.ts / types.ts
│       │   ├── experts/           # 专家：builtin.ts / registry.ts / types.ts
│       │   ├── connectors/        # 连接器：builtin.ts / registry.ts / types.ts / crypto.ts（AES-256-GCM）
│       │   ├── scheduler/         # 定时任务：cron.ts + scheduler-service.ts
│       │   ├── relay/             # 中继客户端：relay-client.ts + device.ts
│       │   ├── attachments.ts     # 用户附件落盘 ~/.nexa/uploads 与读取
│       │   └── ipc/               # （空目录，历史上预留；IPC handler 实际注册在 index.ts）
│       ├── preload/               # 预加载脚本（contextIsolation: true，无 nodeIntegration）
│       │   ├── index.ts           # contextBridge 暴露 window.nexa（必须产出 index.cjs）
│       │   └── index.d.ts         # window.nexa 的类型声明，渲染端 TS 依赖它
│       ├── shared/ipc-channels.ts # 主/渲染共享：IPC 频道常量 + 主→渲染事件联合类型
│       └── renderer/              # 渲染进程（浏览器环境，禁止 Node API）
│           ├── index.html
│           └── src/
│               ├── App.tsx                # 视图路由：tasks / library / scheduled / skill-packs
│               ├── features/              # 按业务域组织（一个域一个目录）
│               │   ├── chat/              # 会话：chat-shell / task-list-panel / note-editor 等
│               │   ├── library/           # 资料库：library-page + files/notes tab
│               │   ├── scheduled/         # 定时任务页
│               │   ├── skill-packs/       # 技能包页
│               │   ├── settings/          # 设置弹框
│               │   ├── artifacts-panel/   # 右侧产物面板
│               ├── components/
│               │   ├── ui/                # shadcn/ui 组件（new-york，勿手改样式约定）
│               │   ├── ai-elements/       # 本地化的 ai-elements（Message / MessageContent / Response / Tool）
│               │   ├── nav-rail.tsx       # 78px 全局图标导航栏（应用骨架，勿放 features）
│               │   ├── page-layout.tsx    # PageTitleBar 等页面骨架
│               │   ├── markdown-renderer.tsx
│               │   └── onboarding-dialog.tsx / relay-pairing-tab.tsx / logo-icon.tsx
│               ├── stores/                # zustand：conversation / artifacts / experts / sidebar / theme / ui
│               └── lib/                   # utils.ts（cn / timeAgo / formatMessageTime）、theme.ts
│
├── nexa-relay/                # 中继服务（无状态路由 + JSON 文件持久化配对）
│   ├── src/index.ts               # HTTP(express) + WS(wss)；配对码/心跳/单播路由；PORT 默认 8787
│   ├── src/store.ts               # 配对数据持久化（默认 ./data，已 gitignore）
│   └── ecosystem.config.cjs       # PM2 部署配置（工具脚本，CJS 属例外）
│
├── nexa-mobile/               # Expo / React Native（v1 仅 Android）
│   ├── app.json                   # scheme=nexa，typedRoutes，expo-camera / secure-store 插件
│   └── src/
│       ├── app/                   # expo-router 文件式路由：_layout / index / home / library / pair / session
│       └── lib/relay/             # client.ts / protocol.ts / service.ts / storage.ts（配对话连接）
│
├── nexa-extension/            # Chrome MV3 插件
│   ├── manifest.json              # MV3；background=ESM(background.js)、action=popup.html、notes.html 可访问
│   ├── scripts/build.mjs          # 混合构建：esbuild(background/options) + Vite(popup/notes) + 拷贝静态资源
│   ├── vite.config.ts / tailwind.config.js / postcss.config.js
│   └── src/
│       ├── background.ts          # Service Worker（ESM）
│       ├── popup/popup.tsx        # 弹窗 React 页面
│       ├── notes/notes.tsx + notes.html   # 笔记管理页（经中继 RPC 写桌面端资料库）
│       ├── options.ts + options.html
│       ├── relay-client.ts        # 与中继的长连接、RPC 单播路由
│       └── shared/notes.ts        # 与桌面端对齐的笔记类型（字段名必须与 SQL schema 一致）
│
└── nexa-shared/               # 三端共享协议包（源码直引，无 build）
    └── src/
        ├── index.ts               # 统一出口：types + relay-protocol + constants
        ├── types/                 # session.ts / knowledge.ts / memory.ts / relay.ts
        ├── relay-protocol/        # encode.ts / validate.ts（消息编解码与校验）
        ├── prompt-templates/      # base.md / memory-extraction.md / experts/
        └── constants.ts
```

### 2.4 路径别名（写 import 必须遵守）

`nexa-desktop`（由 `electron.vite.config.ts` + `tsconfig.web.json` 定义）：

| 别名 | 指向 |
|---|---|
| `@main/*` | `nexa-desktop/src/main/*` |
| `@preload/*` | `nexa-desktop/src/preload/*` |
| `@renderer/*` | `nexa-desktop/src/renderer/src/*` |
| `@shared/*` | `nexa-desktop/src/shared/*` |
| `@nexa/shared` / `@nexa/shared/*` | `nexa-shared/src/index.ts` / `nexa-shared/src/*` |

跨子项目引用共享类型时，**一律用 `@nexa/shared`**，不要用相对路径 `../../nexa-shared/src`。

---

## 3. Restrictions（约束与禁忌）

> 本段是全文最有价值的部分。「不能做什么」比「应该做什么」更能避免大事故。

### 3.1 语言与代码风格

- **一律 TypeScript，禁止新增 `.js` / `.jsx`**。仅以下工具脚本例外：`nexa-extension/scripts/build.mjs`、`nexa-relay/ecosystem.config.cjs`。
- **关键实现必须写中文注释**（业务逻辑、边界条件、跨端约定、非直觉写法）。纯样板代码不必注释。
- 沿用仓库既有风格：**2 空格缩进、不加分号**。
- 禁止引入新的状态管理 / UI / HTTP 库。已有选型：zustand（状态）、shadcn/ui + Radix（UI）、ws（WS）、sql.js（DB）。

### 3.2 UI 硬约束

- UI **必须用 shadcn/ui（new-york 主题，neutral 基色）**，新组件放 `src/renderer/src/components/ui/`；已有封装不要绕过。
- 图标**统一 Lucide（lucide-react）**。**禁止 emoji 图标、禁止手写内联 SVG 图标**。
- 间距遵循 4px 基线；页面为左右分栏，左侧导航栏固定 **78px**，内容需避让 macOS 交通灯。
- 样式用 Tailwind v4 + CSS 变量主题（`--chat-font-size` 等），不要硬编码颜色，用语义 token（`text-muted-foreground`、`bg-card`…）。

### 3.3 Electron 进程边界（极易踩坑）

- **渲染进程是浏览器环境**：`contextIsolation: true`、无 `nodeIntegration`。**禁止**在 `src/renderer/**` 中使用 `fs` / `path` / `child_process` / `require` 等 Node API。
- 渲染端访问主进程能力**只能**通过 `window.nexa.*`（preload 的 `contextBridge` 暴露）；新增能力需三步：preload 暴露 → `src/shared/ipc-channels.ts` 定义频道 → `src/main/index.ts` 注册 `ipcMain.handle`。
- **preload 构建产物必须是 `.cjs`**（`electron.vite.config.ts` 已固定 `format: cjs`），不要改成 ESM。
- **改动 `src/main/**` 或 `src/preload/**` → 必须完全重启桌面端**（退出进程后重新 `npm run dev`），热更新不生效。
  **仅改 `src/renderer/**` → 热更新即可**。改完自行判断是否需要提醒用户重启。

### 3.4 数据与跨端一致性

- SQLite 用 **sql.js（WASM）**，不要换 better-sqlite3 等原生模块（规避 ABI 问题）；`.wasm` 需保留 `asarUnpack` + `extraResources` 配置。
- 表结构类型以 `src/main/db/types.ts` 为**唯一源头**；DAO 查询返回的列名（如 `note_count`，**不是** `count`）必须原样透传。**跨端新增字段时，先看 SQL schema 再写另一端代码**，历史上因字段名不一致导致过 `undefined` 显示 bug。
- 用户数据落盘于 `~/.nexa/`（`settings.json`、`uploads/`、DB 等），**禁止提交**（`.nexa/` 已在 `.gitignore`）。
- 修改 `nexa-shared` 的协议/类型时，必须同步核对**三个消费端**（desktop / mobile / extension）的编译是否仍通过。

### 3.5 构建与依赖

- **`nexa-shared` 不要新增构建步骤**：它用 `exports` 直引 `src/*.ts`，由消费端编译。
- 各子项目 `registry` 已锁定 `https://registry.npmmirror.com/`（见各自 `.npmrc`），不要改动或删除。
- **禁止捏造文件**：写完文件必须立刻核实真实存在（`ls` / `git status`）。历史上出现过「声称已创建但磁盘不存在」的返工。
- 不要提交构建产物：`dist/`、`out/`、`release/`、`web-build/`、`*.tsbuildinfo`（已在 `.gitignore`）。

### 3.6 提交前自检

- 写完代码**必须跑语法/类型检查**：至少 `npm run typecheck`（对应子目录）；改了多个子项目就分别跑。
- 无 lint / test 时，`typecheck` 是唯一自动化门禁，**不得跳过**。
- 不要留下未使用的变量/导入：所有子项目均开启 `strict`；`nexa-extension` 额外开启 `noUnusedLocals` + `noUnusedParameters`（未使用即**报错**）。

---

## 4. Standards（流程规范）

- **提交信息用 Conventional Commits**，与仓库历史一致（`feat:` / `fix:` / `init:` / `chore:` / `refactor:` / `docs:`），描述用中文，例：`feat: 插件端管理笔记`、`fix: 修复应用退出崩溃`。
- **PR 前必须跑完整检查**：改动涉及的每个子项目都执行 `npm run typecheck`；`nexa-desktop` 建议再跑 `npm run build` 确认产物可打。
- **改完代码的固定动作**：`typecheck`（+ 涉及的子项目全部）→ 本地真机/浏览器验证 → 更新 `CHANGELOG.md`。
- **`CHANGELOG.md`** 遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，新改动写入 `[Unreleased]` 的 `Added / Changed / Fixed / Removed` 分类。
- **本地端口**（务必用真实端口，**本项目没有 3000**）：
  - 中继服务：`http://127.0.0.1:8787`（`PORT` 可覆盖）
  - 桌面端 dev：Electron 应用自带远程调试 `9222`（`REMOTE_DEBUGGING_PORT`）
  - 桌面端可视化验证：无 localhost 页面，直接看 Electron 窗口
- **改 UI 后优先真机验证**：桌面端看 Electron 窗口；插件改完在 `chrome://extensions` 重新加载 `nexa-extension/dist/`。
- **新增子项目脚本时保持命名统一**：`dev` / `build` / `typecheck` / `pack` / `dist`（如未来引入 lint，统一为 `lint`，并在本文档同步登记）。
- **文档同步**：若结构性变更（目录、协议、端口、命令）发生，同一提交内更新本 `AGENTS.md`。
