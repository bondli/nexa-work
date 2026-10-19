# Nexa · 详细技术方案 v0.1

> 目标：为 Nexa 三端应用的工程实现提供可落地的技术蓝图，覆盖架构、数据模型、API、Agent 实现、跨端策略、中继服务。

---

## 1. 整体架构

### 1.1 桌面端分层

```
┌─────────────────────────────────────────────────────────────────────┐
│  桌面端 (Electron + React + shadcn/ui)                               │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  UI 层 (React)                                               │   │
│  │  ├─ App.tsx          路由与三栏布局                              │   │
│  │  ├─ Sidebar/         左侧菜单（任务/技能包/资料库/定时）          │   │
│  │  ├─ Conversation/    对话主区域                                 │   │
│  │  ├─ ArtifactsPanel/  右侧产物面板（文件树 + 预览）               │   │
│  │  ├─ SkillPacks/      技能包管理页面                              │   │
│  │  ├─ Library/         资料库页面                                 │   │
│  │  ├─ Scheduled/       定时任务管理页面                            │   │
│  │  ├─ Settings/        系统设置                                  │   │
│  │  └─ Onboarding/      首次启动向导                                │   │
│  └───────────────────────┬─────────────────────────────────────┘   │
│                          │ IPC                                       │
│  ┌───────────────────────▼─────────────────────────────────────┐   │
│  │  本地服务层 (Node.js / Electron main process)                 │   │
│  │                                                               │   │
│  │  ├─ Agent Runtime          基于 @earendil-works/pi-agent-core │   │
│  │  │  ├─ Planner             任务拆解                            │   │
│  │  │  ├─ ToolDispatcher      工具分发                            │   │
│  │  │  ├─ ExpertRouter        专家路由与切换                        │   │
│  │  │  ├─ SkillLoader         按需加载 skills                      │   │
│  │  │  └─ ConversationManager 会话管理                            │   │
│  │                                                               │   │
│  │  ├─ Storage                                                │   │
│  │  │  ├─ SQLite              知识库索引 + 会话元数据 + 定时任务    │   │
│  │  │  ├─ FileSystem          工作目录 + 资料库文件 + 记忆文件       │   │
│  │  │  └─ Config              ~/.nexa/config.json                │   │
│  │                                                               │   │
│  │  ├─ Services                                                │   │
│  │  │  ├─ KnowledgeBase       入库处理 + 召回工具                  │   │
│  │  │  ├─ MemoryEngine        记忆提取 + 合并 + 注入               │   │
│  │  │  ├─ Scheduler           cron 调度 + 执行器                   │   │
│  │  │  ├─ ConnectorManager    连接器凭据管理 + 调用               │   │
│  │  │  └─ RelayClient         与腾讯云中继的 WS 连接               │   │
│  │                                                               │   │
│  │  └─ Bridge → pi-ai         模型调用封装（OpenAI / Anthropic）  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  文件系统: ~/.nexa/                                                │
│  ├─ config.json                                                   │
│  ├─ workspaces/<session-id>/   ← 每个会话独立目录                  │
│  ├─ library/                   ← 知识库文件                        │
│  ├─ memory/                    ← 记忆 JSON 文件                    │
│  ├─ skills/                    ← 用户自建 skills                   │
│  ├─ experts/                   ← 用户自建专家                      │
│  ├─ connectors/                ← 连接器凭据加密存储                │
│  ├─ jobs/                      ← 定时任务脚本                      │
│  └─ nexa.db                    ← SQLite 主库                       │
└─────────────────────────────────────────────────────────────────────┘
          │                                    │
          │ WebSocket                          │ WebSocket
          ▼                                    ▼
┌───────────────────┐              ┌──────────────────────────┐
│  腾讯云中继服务     │◄────────────►│  手机端 (React Native)    │
│  Node.js           │              │  · 会话同步              │
│  · 配对管理        │              │  · 发起任务              │
│  · 消息路由        │              │  · 续跑任务              │
│  · 浏览器插件网关   │              │  · 资料库浏览             │
└───────────────────┘              └──────────────────────────┘
          │ WebSocket
          ▼
┌───────────────────┐
│  浏览器插件         │
│  · 采集 URL        │
│  · 收藏图片        │
│  · 快速搜索        │
└───────────────────┘
```

### 1.2 技术栈总览

| 层 | 技术选型 | 理由 |
|----|---------|------|
| **桌面端容器** | Electron 31+ | 成熟稳定，Node 生态无缝，便于文件系统操作 |
| **桌面端前端** | React 18 + TypeScript + Vite | pi-ai / pi-agent-core 基于 Node，配合 Vite 的快速热更新 |
| **UI 组件** | shadcn/ui + Tailwind CSS | 与 WorkBuddy 视觉对齐，组件可定制源码 |
| **状态管理** | Zustand | 轻量，适合 Electron 的多窗口/进程场景 |
| **本地 Agent** | @earendil-works/pi-ai + pi-agent-core + pi-coding-agent | 用户指定的底层 Agent 框架；coding-agent 内置（见 coding-agent-analysis.md） |
| **模型桥接** | 自研 Bridge 层（统一 Chat Completion 接口） | 同时支持 OpenAI SDK 与 Anthropic SDK |
| **本地数据库** | better-sqlite3 | 同步 API 方便 IPC，性能足够，单文件易备份 |
| **定时调度** | node-cron + 在主进程内执行 | 避免依赖系统 cron，跨平台一致 |
| **文件系统** | Node fs/promises | 工作目录、资料库、记忆文件全部本地管理 |
| **加密** | sodium-native | 连接器凭据本地加密 |
| **中继服务** | **Node.js + Express + ws + better-sqlite3 + PM2** | 轻量方案：无需 PostgreSQL / Redis / Docker。代码扔到腾讯云主机 `pm2 start relay.js` 即可。中继只做配对和消息路由，SQLite 足够 |
| **手机端** | React Native 0.74+ + TypeScript | 用户指定，保障跨端复用（未来 iOS / 鸿蒙） |
| **手机端状态** | Zustand + MMKV | MMKV 高性能本地缓存 |
| **浏览器插件** | Chrome MV3 + Vanilla TS | 最轻量方案，不引入额外打包复杂度 |

---

## 2. Agent 三层能力详细设计

### 2.1 专家（Expert）结构 — 与 WorkBuddy 对齐

WorkBuddy 的专家 = **角色切换机制**，由"人设 + 方法论 + 工具链"三要素组成，本质上就是一个角色 prompt（.md 文件）+ 关联的 Plugin（工具/能力包）。Nexa 的专家在此基础上**扩展了 dispatch_strategy**（因为我们有完整的 Agent Loop 调度能力，WorkBuddy 不显式暴露这一层）。

```yaml
# 示例: ~/.nexa/experts/researcher.yaml
# 与 WorkBuddy 专家的对齐项:
#   ✓ name / description / system_prompt (人设 + 方法论)  → 完全对齐
#   ✓ tools 白名单 / disallow_tools (工具链)             → 完全对齐
#   ✗ dispatch_strategy                                   → Nexa 独有（Agent Loop 调度参数）
name: 研究员
description: 擅长信息检索与深度调研，能输出结构化对比与长文报告
system_prompt: |
  你是一个专业的研究分析师。你的工作流程:
  1. 先用 deep-research skill 做多源检索
  2. 然后整理对比表，从 3 个维度以上进行分析
  3. 最后输出结构化报告（默认 HTML 单文件）
tools:                              # 可用工具白名单
  - web_search
  - web_fetch
  - kb_search
  - file_write
  - file_read
  - skill:deep-research
disallow_tools:                     # 明确禁用的工具（可选）
  - code_execute
  - image_edit
dispatch_strategy:                  # Nexa 独有，Agent Loop 调度参数
  max_steps: 20                     # 最大 plan 步骤数
  allow_parallel: true              # 是否允许并行 tool call
  step_timeout_seconds: 120         # 单步超时
  memory_profile: "concise"         # 记忆注入策略（concise/detail/full）
```

> **与 WorkBuddy 的差异**：WorkBuddy 还有"专家团"（多专家协作，Team Lead + 多个 Agent 成员 + agents/*.md）。Nexa v1 只做单专家，专家团作为 v2 扩展。Skill / Connector 结构与 WorkBuddy 完全一致。

**Agent Loop 如何路由到专家**：

```
每轮对话前，Agent 做路由判断：
  1. 用户显式指定 → 直接使用
  2. 根据最近 3 轮上下文意图匹配 → 自动切换
  3. 当前专家无法完成 → 生成"需要切换"信号 → 路由到新专家

切换时保留对话历史，只替换 system_prompt + tools 白名单 + dispatch_strategy
```

### 2.2 Skill 结构

与 workbuddy 的 Skill 结构对齐：

```yaml
# 示例: ~/.nexa/skills/csv-analyzer.yaml
name: csv-analyzer
description: 解析 CSV 文件，生成统计摘要与可视化图表
version: "1.0.0"
entry: ./index.js
inputs:
  - name: file_path
    type: string
    required: true
    description: CSV 文件的绝对路径
  - name: output_dir
    type: string
    required: false
    default: "auto"
outputs:
  - summary.md
  - chart.html
  - data.csv
prompt_hint: |
  当需要分析 CSV 数据时，请按以下步骤调用此 Skill...
dependencies:
  - lodash
  - echarts
```

**Skill Loader 工作方式**：
- Agent 在 plan 阶段发现需要某个 Skill → `SkillLoader.resolve(name)` → 检查本地目录 → 加载 entry 文件 → 注入 inputs → 执行 → 返回 outputs
- 每个 Skill 是一个独立 Node 子进程（或 VM 沙箱），避免污染主进程
- Skill 之间可以互相依赖声明

### 2.3 连接器（Connector）结构

```yaml
# 示例: ~/.nexa/connectors/feishu.yaml（凭据加密存储）
name: feishu
display_name: 飞书
type: oauth2
config:
  client_id: "cli_xxx"
  # client_secret 加密后存储，运行时由 sodium-native 解密
  encrypted_secret: "..."
  token_endpoint: "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
  base_url: "https://open.feishu.cn/open-apis"
scopes:
  - doc:read
  - doc:write
  - sheet:read
endpoints:
  doc_read:
    method: POST
    path: "/docx/v1/documents/:token/raw_content"
  doc_create:
    method: POST
    path: "/docx/v1/documents"
```

**Connector Manager**：
- 启动时扫描 `~/.nexa/connectors/*.yaml` → 解密凭据 → 缓存
- Agent 调用 `connector.call(name, endpoint, params)` → Manager 统一处理鉴权、重试、错误
- 状态监控：定期调用 `connector.health_check()` → 结果显示在技能包页面

---

## 3. 数据模型

### 3.1 SQLite Schema

```sql
-- 会话（对话任务）
-- 关键设计：两种任务模式
--   free    → 自由任务，workspace_path 由系统自动创建在 ~/.nexa/workspaces/<id>/
--             适合：写报告、数据分析、调研、写小程序（独立产物）
--   project → 项目编码任务，workspace_path 指向用户选择的已有项目目录
--             适合：在已有项目上改代码（"xxx 目录下帮我加会员能力"）
--             删除会话时不清理该目录（用户的项目代码不能删）
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  mode TEXT NOT NULL,               -- 'free' | 'project'
  status TEXT NOT NULL,             -- running / paused / completed / failed
  current_expert TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  workspace_path TEXT NOT NULL,     -- free: ~/.nexa/workspaces/<id>/
                                     -- project: /Users/bondli/projects/recipe-app/
  project_path TEXT,                -- project 模式时记录原始项目根目录（冗余但方便）
  model TEXT NOT NULL,
  metadata JSON
);

-- 会话删除级联清理规则（按 mode 区分）
-- 
-- free 模式（自动创建的 workspace）:
--   1) fs.rmSync(workspace_path, { recursive: true, force: true })  ← 清理工作目录
--   2) DELETE messages / tool_calls / scheduled_jobs / knowledge_items
--
-- project 模式（绑定的用户项目目录）:
--   1) ❌ 不清理 workspace_path！用户的项目代码在那里
--   2) DELETE messages / tool_calls / scheduled_jobs（对话元数据删掉即可）
--      knowledge_items 里如果有 workspace_id 关联的也删（但项目里的原始文件不动）
--
-- 两种模式都保留 memory_items（用户画像跨会话）
-- 删除前若 status='running'：先 Agent session.stop() 等确认后再清理

-- 消息
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,               -- user / assistant / system / tool
  content TEXT NOT NULL,
  tool_name TEXT,                   -- role=tool 时
  tool_call_id TEXT,
  created_at INTEGER NOT NULL,
  token_usage JSON,                 -- { input, output, cost }
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- 工具调用记录
CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  message_id TEXT,                  -- 关联的 assistant message
  tool_name TEXT NOT NULL,
  args JSON NOT NULL,
  result TEXT,
  success INTEGER NOT NULL,         -- 0/1
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);

-- 知识库条目
CREATE TABLE knowledge_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,               -- note / article / image / doc
  title TEXT NOT NULL,
  summary TEXT NOT NULL,            -- LLM 生成的一句话摘要
  keywords JSON NOT NULL,           -- ["kw1", "kw2", ...]
  tags JSON,
  source_url TEXT,
  file_path TEXT NOT NULL,          -- 本地文件相对路径
  workspace_id TEXT,                -- 若来自某次会话
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  embedding_hash TEXT               -- 记录 embedding 是否计算过（预留）
);

-- 定时任务
-- 重要：定时任务不提供"编辑"入口（产品决策：错了删除重建）
-- 所以 handler_config 一旦写入就不可变，只有 enabled / next_run_at 会被调度器更新
CREATE TABLE scheduled_jobs (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,        -- 自然语言描述
  cron_expr TEXT NOT NULL,          -- 创建后不可变
  handler_type TEXT NOT NULL,       -- 创建后不可变
  handler_config JSON NOT NULL,     -- 创建后不可变（脚本路径 / session_id / skill 名称等）
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  next_run_at INTEGER,
  last_result TEXT,
  created_at INTEGER NOT NULL,
  created_by_session TEXT REFERENCES sessions(id)
);

-- 定时任务执行记录
CREATE TABLE job_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES scheduled_jobs(id),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  success INTEGER NOT NULL,
  output TEXT,
  artifacts JSON                    -- 产物文件路径列表
);

-- 记忆条目
CREATE TABLE memory_items (
  id TEXT PRIMARY KEY,
  layer TEXT NOT NULL,              -- profile / state / preference
  category TEXT NOT NULL,           -- 具体分类如关注方向/职业/偏好格式
  content TEXT NOT NULL,            -- 纯文本（v1 简化，不存 JSON）
  confidence REAL NOT NULL,         -- 0.0 - 1.0
  source_session TEXT REFERENCES sessions(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- 去重 upsert 逻辑: 同 layer + category 已有条目 → 直接更新 content + confidence + updated_at
-- （硬删除语义：新条目覆盖旧条目，不保留 superseded_by 链）

-- 连接器调用记录
CREATE TABLE connector_logs (
  id TEXT PRIMARY KEY,
  connector_name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  success INTEGER NOT NULL,
  latency_ms INTEGER,
  created_at INTEGER NOT NULL
);

-- 结构化笔记（v1 新增：支持会议记录 Q&A 补充、分类、草稿/提交状态）
CREATE TABLE notes (
  id TEXT PRIMARY KEY,                    -- uuid
  title TEXT NOT NULL,                    -- 笔记标题
  content TEXT NOT NULL DEFAULT '',       -- markdown 正文
  status TEXT NOT NULL DEFAULT 'draft',   -- 'draft' | 'submitted'
  category TEXT NOT NULL DEFAULT '未分类', -- 分类（扁平字符串）
  tags TEXT NOT NULL DEFAULT '[]',        -- JSON 数组，存标签
  linked_session TEXT REFERENCES sessions(id), -- 可选，关联某次 Agent 会话
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 用户自定义笔记分类
CREATE TABLE note_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  icon TEXT,                              -- emoji 图标
  sort_order INTEGER NOT NULL DEFAULT 0,  -- 显示顺序
  is_preset INTEGER NOT NULL DEFAULT 0,   -- 1=内置不可删除
  created_at INTEGER NOT NULL
);
-- 预置 4 个分类（首次启动 seed）
-- '会议'  学习'  '工作'  '灵感'  '未分类'

-- 索引
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_messages_session ON messages(session_id, created_at);
CREATE INDEX idx_knowledge_type ON knowledge_items(type);
CREATE INDEX idx_knowledge_keywords ON knowledge_items(keywords);
CREATE INDEX idx_knowledge_created ON knowledge_items(created_at DESC);
CREATE INDEX idx_jobs_next_run ON scheduled_jobs(next_run_at);
CREATE INDEX idx_memory_layer ON memory_items(layer);
CREATE INDEX idx_notes_category ON notes(category, updated_at DESC);
CREATE INDEX idx_notes_status ON notes(status);
CREATE INDEX idx_notes_updated ON notes(updated_at DESC);
```

### 3.1.1 Notes IPC 通道

```typescript
// 主进程暴露给 renderer 的通道
ipcMain.handle('note:list', (_e, opts: { category?, status?, search? }) => {
  // 返回 notes 数组，按 category 分组（前端渲染分组时直接用）
  return db.prepare(
    `SELECT * FROM notes 
     WHERE (@cat IS NULL OR category=@cat) 
       AND (@st IS NULL OR status=@st)
       AND (@search IS NULL OR title LIKE '%'||@search||'%' OR content LIKE '%'||@search||'%')
     ORDER BY category, updated_at DESC`
  ).all({ cat, st, search });
});

ipcMain.handle('note:get', (_e, id: string) => ...);
ipcMain.handle('note:create', (_e, data: Partial<Note>) => ...);     // 新建空笔记，status=draft
ipcMain.handle('note:update', (_e, id: string, patch: Partial<Note>) => ...); // 保存草稿 / 提交
ipcMain.handle('note:delete', (_e, id: string) => ...);
ipcMain.handle('note:append', (_e, id: string, block: string) => ...);       // Agent v2 用：追加 markdown 块
ipcMain.handle('note:categories', () => ...);                                  // 列出所有分类 + 每个分类下笔记数
ipcMain.handle('note:addCategory', (_e, name: string) => ...);
ipcMain.handle('note:removeCategory', (_e, id: string) => ...);
```

### 3.2 文件系统结构

```
~/.nexa/
├── config.json                      # 用户配置、模型配置、偏好
├── sessions/                        # 会话元数据（与 SQLite 同步）
│   └── <session-id>/
│       └── meta.json
├── workspaces/<session-id>/         # 每个会话独立工作目录
│   ├── scripts/                     # Agent 生成的代码
│   ├── data/                        # 下载/处理的数据文件
│   ├── outputs/                     # 最终产物
│   │   ├── report.html
│   │   ├── chart.png
│   │   └── summary.md
│   └── .nexa-state.json             # Agent 内部状态快照
├── library/
│   ├── notes/
│   │   └── 2026-10-12-weekly-meeting.md
│   ├── articles/
│   │   ├── clean_article.md         # 正文提取后的 markdown
│   │   └── original.html            # 原始 HTML
│   ├── images/
│   │   ├── original.jpg
│   │   └── ocr.txt
│   └── docs/
├── memory/
│   ├── profile.json                 # Layer 1 静态画像
│   ├── state.json                   # Layer 2 动态状态
│   └── preferences.json             # Layer 3 偏好规则
├── skills/                          # 用户自建 skills
├── experts/                         # 用户自建专家
├── connectors/                      # 凭据加密存储
├── jobs/                            # 定时任务脚本
└── nexa.db
```

### 3.3 config.json 结构

```json
{
  "user": {
    "name": "Bond",
    "avatar": null,
    "language": "zh-CN",
    "onboardingCompleted": true
  },
  "models": {
    "default": "deepseek-chat",
    "providers": {
      "deepseek": {
        "type": "openai-compatible",
        "baseUrl": "https://api.deepseek.com/v1",
        "apiKey": "sk-xxx",
        "models": ["deepseek-chat", "deepseek-reasoner"]
      },
      "openai": {
        "type": "openai",
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "sk-xxx",
        "models": ["gpt-4o", "o1-preview"]
      },
      "anthropic": {
        "type": "anthropic",
        "baseUrl": "https://api.anthropic.com",
        "apiKey": "sk-ant-xxx",
        "models": ["claude-sonnet-4-20250514"]
      }
    }
  },
  "relay": {
    "serverUrl": "wss://nexa-relay.yourcloud.com",
    "pairingCode": "A1B2C3",
    "pairedDevices": [
      { "id": "android-xxx", "name": "Pixel 9", "pairedAt": 1728900000 }
    ]
  },
  "display": {
    "compactMode": true,
    "fontSize": "medium",
    "showToolDetails": false
  },
  "storage": {
    "workspaceRoot": "~/.nexa/workspaces",
    "libraryRoot": "~/.nexa/library"
  }
}
```

---

## 4. Agent Runtime 实现（基于 pi-ai / pi-agent-core）

### 4.1 核心循环

```typescript
// Agent Runtime 伪代码
class NexaAgent {
  private loop: piAgentCore.AgentLoop;
  private expertRouter: ExpertRouter;
  private skillLoader: SkillLoader;
  private toolDispatcher: ToolDispatcher;
  private memoryEngine: MemoryEngine;

  // ===== 任务模式 & workspace 决策 =====
  // 新建会话时调用（由 UI 传入 mode 和可选的 projectPath）
  async createSession(params: {
    initialMessage: string;
    mode: 'free' | 'project';
    projectPath?: string;        // project 模式必填
    model: string;
    expertId?: string;
  }): Promise<Session> {
    const id = uuidv4();
    let workspacePath: string;

    if (params.mode === 'free') {
      // 自由模式：系统自动创建隔离目录
      workspacePath = path.join(NEXA_HOME, 'workspaces', id);
      fs.mkdirSync(workspacePath, { recursive: true });
    } else {
      // 项目模式：绑定用户选择的已有目录
      workspacePath = path.resolve(params.projectPath!);
      // 安全校验：目录必须存在且是真实目录
      const stat = fs.statSync(workspacePath);
      if (!stat.isDirectory()) throw new Error('projectPath 不是目录');
    }

    // 写入 sessions 表
    const session = db.prepare(`INSERT INTO sessions
      (id, title, mode, workspace_path, project_path, model, ...)
      VALUES (?,?,?,?,?,?,...)`).run({...});

    // 通知 UI 侧边栏新增该项
    mainWindow.webContents.send('agent:event', {
      type: 'session.created',
      sessionId: id, title: autoTitle(params.initialMessage), mode: params.mode
    });

    return this.runSession(id, params.initialMessage);
  }

  async runSession(sessionId: string, initialMessage: string) {
    // 1. 加载会话（含 mode + workspace_path）
    const session = db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
    const context = await this.buildContext(sessionId);
    context.mode = session.mode;
    context.workspacePath = session.workspace_path;

    // 2. 路由到合适的专家
    const expert = this.expertRouter.resolve(context, initialMessage);
    context.expert = expert;

    // 3. 项目模式下：在 system prompt 里注入项目上下文
    //    让 Agent 知道自己在操作真实项目（更谨慎）
    //    同时扫描项目目录，自动把 AGENTS.md / README.md 等项目指令文件塞进 context
    if (session.mode === 'project') {
      const projectFiles = scanProjectHints(session.workspace_path);
      context.projectHints = projectFiles;
    }

    // 4. 构建 system prompt（注入记忆 + 项目上下文）
    context.systemPrompt = this.composeSystemPrompt(expert, context);

    // 4. 执行 Agent Loop
    while (!context.done) {
      const llmOutput = await this.loop.step(context);

      if (llmOutput.type === 'tool_call') {
        // 工具调用，可能触发 Skill Loader
        const result = await this.toolDispatcher.dispatch(
          llmOutput.toolName, llmOutput.args, context
        );
        context.history.push({ role: 'tool', content: result });
      } else if (llmOutput.type === 'expert_switch') {
        context.expert = this.expertRouter.switchTo(llmOutput.target, context);
      } else if (llmOutput.type === 'final') {
        context.done = true;
      }

      // 每步后检查是否需要沉淀记忆
      await this.memoryEngine.tick(context);
    }

    // 5. 执行后处理
    await this.postRun(context);
  }

  private composeSystemPrompt(expert: Expert, ctx: Context): string {
    return [
      expert.systemPrompt,
      this.memoryEngine.profileBlock(),      // Layer 1
      this.memoryEngine.stateBlock(ctx),      // Layer 2（按上下文筛选）
      this.memoryEngine.preferenceBlock(expert), // Layer 3（按专家筛选）
      `\n当前工作目录: ${ctx.workspacePath}`,
      `\n可用 Skills: ${ctx.availableSkills.join(', ')}`,
      `\n可用连接器: ${ctx.availableConnectors.join(', ')}`
    ].join('\n\n');
  }
}
```

### 4.2 工具集（Agent 可调用的内建工具）

| 工具名 | 类别 | 功能 |
|--------|------|------|
| `web_search` | 信息获取 | 调用搜索引擎 API |
| `web_fetch` | 信息获取 | 抓取 URL 内容，转换为 markdown |
| `kb_search` | 知识库 | 从本地知识库召回条目（见 5.4 API） |
| `kb_add_note` | 知识库 | 对话中的笔记入库 |
| `kb_add_article` | 知识库 | URL → 正文提取 → 入库 |
| `kb_add_image` | 知识库 | 图片 + 描述入库 |
| `file_read` | 文件系统 | 读取文件 |
| `file_write` | 文件系统 | 写入文件（限制在 workspace 内） |
| `file_list` | 文件系统 | 列出 workspace 目录 |
| `code_execute` | 执行 | 在沙箱中执行 Python / Node 代码 |
| `code_run_script` | 执行 | 执行 workspace 下已有的脚本 |
| `skill_invoke` | Skill | 调用某个已安装 Skill |
| `connector_call` | 连接器 | 调用某个连接器的 endpoint |
| `memory_read` | 记忆 | 读取自己的记忆条目 |
| `memory_write` | 记忆 | 显式写入一条记忆 |
| `schedule_create` | 定时 | 创建定时任务（Agent 内部用） |
| `schedule_list` | 定时 | 列出定时任务 |
| `session_create` | 会话 | 发起新会话（续跑等场景） |
| `session_list` | 会话 | 列出所有会话 |
| `human_ask` | 交互 | 暂停执行，向用户提问等待回复 |

### 4.3 workspace 隔离安全策略

- 所有文件写入操作强制路径检查：`path.startsWith(workspacePath)` 才放行
- `code_execute` 在独立 Node 子进程 / Docker 容器（可选）中执行，有超时和内存上限
- 连接器凭据不走 Agent context，只在 Connector Manager 内部解密

---

## 5. 知识库召回实现（不用 RAG）

### 5.1 召回流程的完整代码草图

```typescript
class KnowledgeBaseService {
  search(params: KBSearchParams): KBItem[] {
    const { query, type, tags, timeRange, topN = 5, includeContent = true } = params;

    // 第一步: SQLite 粗筛
    const sql = this.buildSearchSQL(params);
    // keywords JSON 数组做 LIKE 匹配 + tags 匹配
    const candidates = this.db.prepare(sql).all(query, ...);

    // 第二步: LLM 重排序
    const reranked = this.llmRerank(query, candidates);

    // 第三步: 取 topN，按需加载文件内容
    return reranked.slice(0, topN).map(item => ({
      ...item,
      content: includeContent ? fs.readFileSync(item.filePath, 'utf-8') : undefined
    }));
  }

  private buildSearchSQL(params: KBSearchParams): string {
    // 核心思路:
    // keywords 是 JSON 数组，用 json_each 展开后匹配
    // 同时在 title, summary, tags 上做 ILIKE
    return `
      SELECT DISTINCT ki.*
      FROM knowledge_items ki
      WHERE 1=1
        ${params.type ? 'AND ki.type = ?' : ''}
        ${params.timeRange?.since ? 'AND ki.created_at >= ?' : ''}
        ${params.timeRange?.until ? 'AND ki.created_at <= ?' : ''}
        AND (
          ki.title LIKE ?
          OR ki.summary LIKE ?
          OR ki.tags LIKE ?
          OR EXISTS (
            SELECT 1 FROM json_each(ki.keywords)
            WHERE value LIKE ?
          )
        )
      ORDER BY ki.created_at DESC
      LIMIT 30  -- 粗筛先取 30 条交给 LLM
    `;
  }

  private llmRerank(query: string, candidates: KBItem[]): KBItem[] {
    // 让 LLM 根据 query 对 30 条候选做相关性打分
    // prompt 示例:
    // "以下 30 条知识库条目，按与查询 '<query>' 的相关度从高到低排序，输出 JSON [{id, score}]"
    // 返回后用 score 排序
  }
}
```

### 5.2 入库时的处理流水线

```typescript
async function ingestArticle(source: ArticleSource): Promise<string> {
  const id = uuidv4();

  // 1. 正文提取（用 readability / trafilatura 类库）
  const extracted = await extractContent(source.html);

  // 2. 写入文件系统
  const cleanPath = path.join(libraryRoot, 'articles', `${id}.md`);
  fs.writeFileSync(cleanPath, extracted.markdown);

  // 3. 去重检查（URL hash + 标题相似度）
  const isDuplicate = await dbCheckDuplicate(source.url, extracted.title);
  if (isDuplicate) return null;

  // 4. LLM 自动生成元数据
  const meta = await llmGenerateMeta(extracted.markdown);
  // → { summary, keywords: [...], tags: [...], title }

  // 5. 写入 SQLite
  db.prepare(`INSERT INTO knowledge_items (...) VALUES (...)`).run({
    id, type: 'article',
    title: meta.title, summary: meta.summary,
    keywords: JSON.stringify(meta.keywords),
    tags: JSON.stringify(meta.tags),
    source_url: source.url,
    file_path: cleanPath,
    created_at: Date.now()
  });

  // 6. 触发记忆检查（后台）
  memoryEngine.checkForNewInterest(meta.keywords, extracted.markdown);

  return id;
}
```

---

## 6. 自进化记忆层

### 6.1 MemoryEngine 核心逻辑

```typescript
class MemoryEngine {
  private roundCount = 0;

  // 每 5 轮对话触发一次（降低 LLM 调用成本，同时保持足够实时性）
  async tick(context: ConversationContext) {
    this.roundCount++;
    if (this.roundCount % 5 !== 0) return;

    const lastUserMsg = context.history.at(-2);
    const lastAssistantReply = context.history.at(-1);
    const lastToolResults = collectLastToolResults(context);

    const extraction = await this.llmExtract(
      lastUserMsg, lastAssistantReply, lastToolResults
    );

    for (const mem of extraction.newMemories) {
      this.upsert(mem);
    }
  }

  // 用户显式「记住 xxx」也走 LLM 提取（保持一致性，让 LLM 判断该写入哪一层）
  async handleExplicitRemember(text: string, sessionId: string) {
    const extraction = await this.llmExtract(
      text, '', [{ type: 'explicit_remember' }]
    );
    for (const mem of extraction.newMemories) {
      this.upsert({ ...mem, source_session: sessionId });
    }
  }

  // KB 入库时触发（自动提取新记忆）
  async onKnowledgeItemCreated(item: KnowledgeItem) {
    const extraction = await this.llmExtract(
      '', '', [{ type: 'knowledge_item', content: item.summary || item.title, keywords: item.keywords }]
    );
    for (const mem of extraction.newMemories) {
      this.upsert(mem);
    }
  }

  // 硬删除语义: 同 layer + category 直接覆盖
  private upsert(mem: Partial<MemoryItem>) {
    const existing = db.prepare(
      `SELECT * FROM memory_items WHERE layer=? AND category=?`
    ).get(mem.layer, mem.category);

    if (existing) {
      db.prepare(
        `UPDATE memory_items SET content=?, confidence=?, updated_at=? WHERE id=?`
      ).run(mem.content, mem.confidence, Date.now(), existing.id);
    } else {
      db.prepare(
        `INSERT INTO memory_items (id, layer, category, content, confidence, source_session, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(uuidv4(), mem.layer, mem.category, mem.content, mem.confidence,
            mem.source_session, Date.now(), Date.now());
    }
  }

  private async llmExtract(user: string, assistant: string, tools: any[]): Promise<ExtractionResult> {
    // 使用便宜模型（deepseek-chat 即可），控制成本
    // 输出 JSON: { shouldUpdate: boolean, newMemories: [{ layer, category, content, confidence }] }
  }
}
```

### 6.2 读取策略

```sql
-- 读取有效记忆（没有 superseded_by 字段了，因为硬删除覆盖）
SELECT * FROM memory_items
WHERE confidence > 0.6
ORDER BY layer, confidence DESC, updated_at DESC

-- 按上下文筛选注入:
-- project 模式: 全量 Layer 2 (state) + Layer 3 (preferences)
-- free 模式: Layer 1 (profile) + Layer 3 (preferences) 优先
```

---

## 7. 定时任务调度器

```typescript
class SchedulerService {
  private schedulerMap = new Map<string, JobHandle>();

  start() {
    const jobs = db.getEnabledJobs();
    for (const job of jobs) {
      this.schedule(job);
    }
  }

  private schedule(job: ScheduledJob) {
    const handle = nodeCron.schedule(job.cron_expr, async () => {
      const runId = uuidv4();
      db.insertJobRun(runId, job.id, Date.now());

      try {
        const result = await this.executeJob(job);
        db.completeJobRun(runId, true, JSON.stringify(result));
        db.updateJobNextRun(job.id);
      } catch (err) {
        db.completeJobRun(runId, false, err.message);
      }
    });
    this.schedulerMap.set(job.id, handle);
  }

  private async executeJob(job: ScheduledJob): Promise<any> {
    switch (job.handler_type) {
      case 'script':
        return runChildProcess(job.handler_config.scriptPath);
      case 'skill':
        return skillLoader.invoke(job.handler_config.skillName, job.handler_config.inputs);
      case 'session_continuation':
        return agentRuntime.continueSession(job.handler_config.sessionId, job.handler_config.prompt);
    }
  }
}
```

Agent 对话中 `schedule_create` 工具就是写入 SQLite + 触发 SchedulerService 热加载新 job。

---

## 8. 中继服务（腾讯云 + Node.js）

### 8.1 协议设计

```
桌面端 ←── WebSocket ──► 中继服务器 ◄── WebSocket ──► 手机端
                              │
                              ├── 配对管理（SQLite）
                              └── 消息路由（纯内存，不持久化业务消息）
```

### 8.2 核心消息类型

```typescript
// 所有消息带 type + payload
type RelayMessage = {
  type: PairingMessage | SessionMessage | TaskMessage | ArtifactMessage | PingMessage;
  deviceId: string;
  timestamp: number;
  payload: any;
};

// 示例: 手机端发起新任务 → 中继 → 桌面端
{
  type: 'task:create',
  deviceId: 'android-pixel-9',
  payload: {
    prompt: '帮我看看今天的特斯拉股价',
    model: 'deepseek-chat'
  }
}

// 示例: 桌面端任务需要用户决策 → 中继 → 手机端推送
{
  type: 'session:human-ask',
  deviceId: 'desktop-bond-mac',
  payload: {
    sessionId: 'xxx',
    question: '图表风格选择？',
    options: ['简洁', '专业', '炫彩']
  }
}

// 示例: 浏览器插件采集 → 中继 → 桌面端入库
{
  type: 'library:ingest-article',
  deviceId: 'chrome-plugin',
  payload: {
    url: 'https://...',
    html: '<!DOCTYPE html>...',
    title: '自动提取'
  }
}
```

### 8.3 配对流程

```
桌面端                              中继服务器                         手机端
  │                                    │                                │
  │  POST /pairing/create              │                                │
  │  → 生成 6 位码 A1B2C3               │                                │
  │                                    │                                │
  │  WS connect (deviceId=desktop)      │                                │
  │                                    │                                │
  │                                    │  WS connect (deviceId=android)  │
  │                                    │  + pairing_code=A1B2C3          │
  │                                    │                                │
  │                                    │  验证配对码 → 成功 → 建立路由     │
  │                                    │                                │
  │  ← relay:pairing-success ────────────┤                                │
  │                                    ├──── relay:pairing-success ────►│
  │                                    │                                │
  │  ← 后续所有消息路由到已配对设备         │                                │
```

### 8.4 中继服务器关键代码

```typescript
// server/index.ts
import express from 'express';
import { WebSocketServer } from 'ws';
import Database from 'better-sqlite3';

const app = express();
const wss = new WebSocketServer({ port: 8080 });
const db = new Database('./relay.db');

// 配对表
db.exec(`
  CREATE TABLE IF NOT EXISTS pairings (
    code TEXT PRIMARY KEY,
    desktop_id TEXT NOT NULL,
    status TEXT NOT NULL,         -- pending / confirmed
    created_at INTEGER NOT NULL
  );
`);

// 设备连接映射（内存）
const connections = new Map<string, WebSocket>();
const pairings = new Map<string, { desktopId: string; phoneId?: string }>();

// REST: 创建配对
app.post('/api/pairing', (req, res) => {
  const code = generate6CharCode();
  const desktopId = req.body.deviceId;
  db.prepare('INSERT INTO pairings VALUES (?, ?, ?, ?)')
    .run(code, desktopId, 'pending', Date.now());
  res.json({ code });
});

// WebSocket 消息路由
wss.on('connection', (ws, req) => {
  const deviceId = extractDeviceId(req);
  connections.set(deviceId, ws);

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());

    // 根据配对关系找到对端设备
    const peerId = findPairedPeer(deviceId);
    if (peerId && connections.has(peerId)) {
      connections.get(peerId)!.send(raw.toString());
    }
  });

  ws.on('close', () => connections.delete(deviceId));
});

function findPairedPeer(deviceId: string): string | null {
  for (const [code, pair] of pairings) {
    if (pair.desktopId === deviceId) return pair.phoneId;
    if (pair.phoneId === deviceId) return pair.desktopId;
  }
  return null;
}
```

### 8.5 安全考虑

- 所有 WebSocket 连接使用 TLS（腾讯云证书）
- 配对码一次性使用，成功后立即失效
- 中继服务器不存储业务内容（对话、文件），只做路由
- 连接器凭据只在本地桌面端加密存储，不走中继

---

## 9. 浏览器插件

### 9.1 MV3 结构

```
extension/
├── manifest.json
├── background.ts        # Service Worker（消息转发到中继）
├── popup.html           # 插件弹出界面
├── popup.tsx
├── options.html         # 首次配置（配对码输入）
├── options.ts
├── content.ts           # 页面注入（右键菜单、图片收藏）
└── icons/
```

### 9.2 核心流程

**采集 URL 为文章**：
```
用户点击插件图标 → "采集此页面"
  → content.ts 获取 document.documentElement.outerHTML
  → 发送到中继 (type: 'library:ingest-article')
  → 中继路由到已配对的桌面端
  → 桌面端 Agent 调用 ingestArticle() → 知识库入库
  → 桌面端推送回传采集结果 → 插件 Toast 通知"采集成功"
```

**收藏图片**：
```
Chrome 右键菜单 "Nexa 收藏图片"
  → content.ts 获取 img src
  → 下载图片 → 发送到中继
  → 桌面端存入 ~/.nexa/library/images/
```

---

## 10. 跨端复用策略

### 10.1 三端共用的核心逻辑

```
nexa-shared/                      ← 独立 npm 包
├── types/                        ← 三端共享的 TypeScript 类型定义
│   ├── session.ts
│   ├── message.ts
│   ├── knowledge.ts
│   ├── memory.ts
│   ├── relay.ts                  ← 中继消息协议
│   └── connector.ts
├── relay-protocol/               ← 中继消息编解码（纯函数）
│   ├── encode.ts
│   ├── decode.ts
│   └── validate.ts
├── prompt-templates/             ← 系统提示词模板（版本化）
│   ├── base.md
│   ├── experts/
│   └── memory-extraction.md
└── constants.ts                  ← 模型列表、默认路径等
```

### 10.2 各端技术选型总结

| 端 | 框架 | UI | 状态管理 | 存储 | 网络 |
|----|------|----|---------|------|------|
| 桌面 | Electron 31 + React 18 | shadcn/ui + Tailwind | Zustand | better-sqlite3 + fs | IPC + WS 中继 |
| 手机 | React Native 0.74 | NativeWind (Tailwind RN) | Zustand + MMKV | WatermelonDB (SQLite ORM) | WS 中继 |
| 插件 | MV3 + Vanilla TS | 原生 HTML | 无（无状态） | chrome.storage.local | WS 中继 |

---

## 11. 桌面端项目结构

```
nexa-desktop/
├── electron/
│   ├── main.ts                    # Electron 主进程
│   ├── preload.ts                 # IPC bridge
│   └── services/
│       ├── agent/                 # Agent Runtime
│       ├── storage/                # SQLite + FileSystem
│       ├── kb/                     # KnowledgeBaseService
│       ├── memory/                 # MemoryEngine
│       ├── scheduler/              # Cron 调度
│       ├── connectors/             # ConnectorManager
│       └── relay/                  # RelayClient (WS)
├── src/
│   ├── App.tsx
│   ├── components/
│   │   ├── ui/                     # shadcn/ui 组件
│   │   ├── sidebar/
│   │   ├── conversation/
│   │   ├── artifacts-panel/
│   │   ├── skill-packs/
│   │   ├── library/
│   │   ├── scheduled/
│   │   ├── settings/
│   │   └── onboarding/
│   ├── stores/                     # Zustand stores
│   ├── hooks/
│   ├── lib/
│   └── types/
├── skills/                         # 内置 Skills（打包进 app）
├── experts/                        # 内置专家（打包进 app）
├── connectors/                     # 内置连接器（打包进 app）
└── package.json
```

---

## 12. 开发里程碑

| 里程碑 | 范围 | 交付物 |
|--------|------|--------|
| M1 · 骨架与 Agent 核心 | Electron + React 骨架 + pi-ai 集成 + 内建 Agent Loop + 本地 SQLite | 可运行桌面应用，Agent 能跑通一轮对话 |
| M2 · 三栏 UI + 对话 | 左侧菜单 + 中间对话流 + 右侧产物面板 + WorkBuddy 视觉 | 完整桌面端主界面 |
| M3 · Skills / 专家 / 连接器 | 三层能力模型全部跑通 + 技能包管理页面 | Agent 能按需切换专家、加载 Skill、调用连接器 |
| M4 · 知识库 + 记忆 | 知识库入库流水线 + SQLite 粗筛 + LLM 重排召回 + 记忆三层 | 知识库可用，Agent 能从记忆中读取偏好 |
| M5 · 定时任务 + 手机 | 对话式 cron 创建 + 管理面板 + 中继服务 Node.js + Android React Native | 手机能发起/续跑桌面任务 |
| M6 · 浏览器插件 + 完善 | 插件采集 URL/图片 + 设置完善 + 安全加固 | 三端闭环 |

---

## 13. 评审要点（技术）

1. **pi-ai / pi-agent-core 的集成方式**：需要先调研这两个包的实际 API 再定集成细节，当前方案中 `AgentRuntime` 的代码是伪代码级别的。
2. **知识库召回精度**：SQLite + LLM 重排在千-万级条目下的精度需要实测。如果后期精度不够，是否允许引入轻量 embedding（本地小模型）做补充？
3. **Agent 代码沙箱**：v1 用 Node 子进程即可，Docker 容器级隔离是否需要预留？
4. **中继服务是否需要 HTTPS 证书自动续期**（腾讯云证书 + certbot）？
5. **手机端 v1 是否同时做 iOS**（React Native 一套代码理论上能双端，但 v1 先 Android 更聚焦）？
