# Nexa · Coding Agent 分析方案

> 核心问题：Nexa 的 Agent 要能写代码。选内置 @earendil-works/pi-coding-agent 就够，还是需要外接 OpenAI Codex CLI？

## ✅ 决策定案（2026-10-12）

v1 采用 **内置 pi-coding-agent + 用户手动切换模型**。不做自动切强模型逻辑。

- 模型：用用户在设置里配置的**默认模型**，用户在 chat 顶部的模型下拉框手动切换即可。Coding Agent 不做自动模型路由。
- 沙箱：直接在 workspace 目录运行（零依赖，个人用户安全边界内足够）。
- 不外接 Codex CLI（用户已配 deepseek/openai/anthropic 任一即可，不想额外成本）。

下面是完整分析过程，供后续参考。

---

## 1. 背景与约束

用户明确指出：
- Nexa 的 Agent 需要能写代码（coding-agent 是必备能力，不是可选）
- **不想让用户为了写代码额外购买模型**（deepseek/openai/anthropic 这些用户已经配置好的，要能直接复用）
- 但也担心内置 coding-agent 的编码能力不足

这形成了一个张力：能力 vs 成本 vs 用户体验。

---

## 2. 两个候选方案对比

### 2.1 方案 A：内置 @earendil-works/pi-coding-agent

**是什么**：Pi 体系的官方 coding agent，npm 包。本质是一个最小化的 coding harness，核心就是 Agent Loop + 4 个核心工具 + 可扩展的 Skill/Extension 机制。

| 维度 | 详情 |
|------|------|
| **核心工具** | read / write / edit / bash（4 个） |
| **架构哲学** | 刻意最小化：sub-agents、plan mode、sandboxing 都是可选扩展 |
| **模型支持** | 15+ providers —— Anthropic, OpenAI, Google, Azure, Bedrock, Mistral, **deepseek**（通过 OpenAI 兼容接口）、等 |
| **SDK 模式** | ✅ 有，可以作为库嵌入 Electron main process |
| **成本** | 零额外成本。用什么模型用户自己在设置里配，coding-agent 只是工具，复用已有模型 |
| **代码执行** | bash 工具直接跑 shell 命令（在主进程或子进程里），无 Docker 沙箱 |
| **质量上限** | 取决于用户选的模型。用 deepseek 大概 GPT-3.5 水平；用 o1-preview / claude sonnet 4 可以到强 Coding 水平 |

**能力边界分析**：

```
pi-coding-agent 能做的:
  ✅ 单文件 / 多文件代码生成
  ✅ 代码编辑（定位 + 修改 + 验证）
  ✅ bash 命令执行（跑 npm install / 跑测试 / 启动 dev server）
  ✅ 项目级理解（AGENTS.md 项目指令 + 文件树）
  ✅ mid-session 切模型（先用快模型 scaffold，切强模型写核心逻辑）
  ✅ 与用户已有 15+ 模型 provider 直接对接

pi-coding-agent 做不到的（或很弱的）:
  ❌ 生产级 sandboxing（V8 或 Docker 隔离）
  ❌ 自动跑测试 + 修 lint + 提交 git 的完整闭环
  ❌ 跨多语言复杂重构（50+ 文件大规模改动）
  ❌ 多 agent 协作分模块写代码（v1 只做单专家，不做专家团）
  ❌ 浏览器级预览（需要 Nexa 自己的右侧面板 + 内嵌浏览器）
```

### 2.2 方案 B：外接 OpenAI Codex CLI

**是什么**：OpenAI 官方的本地 coding agent，Rust 编写。架构是"模型层 + Harness + 沙箱层"三件套，重生产级可靠性。

| 维度 | 详情 |
|------|------|
| **核心能力** | 文件读写编辑 + 命令执行 + 浏览器 + MCP tools |
| **架构哲学** | 生产级安全 + 可靠性优先（Rust 重写 + 沙箱） |
| **模型** | OpenAI Codex 专用模型（需要单独的 Codex 订阅 / API） |
| **接入方式** | 子进程 spawn `codex` CLI，或通过 stdin/stdout pipe |
| **成本** | ⚠️ 用户需要额外购买 Codex（ChatGPT Pro 自带但桌面端没有原生接入，或直接 OpenAI API 付费） |
| **沙箱** | Rust 级文件系统隔离 + 命令执行权限控制 |

### 2.3 核心差异对比

| 维度 | pi-coding-agent | Codex CLI | 胜出 |
|------|----------------|-----------|------|
| **用户额外成本** | 零（复用已配置模型） | 需要 Codex 订阅或 API key | **pi 碾压** |
| **模型选择** | 15+ providers | OpenAI 专属 | **pi 碾压** |
| **嵌入难度** | npm SDK，直接 import | 子进程 spawn + pipe 协议 | **pi 碾压** |
| **编码能力上限** | 取决于用户模型 | 专用 Codex 模型，专门优化过 | **Codex 碾压** |
| **执行安全** | Node 子进程（轻量隔离） | Rust 沙箱（生产级） | **Codex** |
| **可扩展性** | Skill / Extension 生态 | MCP tools | 打平 |
| **离线/内网** | 取决于模型 | 取决于模型 | 打平 |
| **与 pi-agent-core 集成** | 同体系，天然无缝 | 跨框架，需要桥接层 | **pi 碾压** |

---

## 3. 推荐方案：分层策略

### 3.1 v1 默认：内置 pi-coding-agent + 用户已配置模型

**理由**：
1. **零额外成本**——这是用户最在意的约束
2. **无缝集成**——同 pi 体系，Agent Runtime 直接 SDK 调用，无需子进程桥接
3. **模型能力足够覆盖绝大多数场景**——deepseek-chat 可以写中小规模代码（单文件脚手架、脚本、简单 CRUD、单文件 HTML 应用），o1-preview / claude sonnet 4 可以处理更复杂的任务（多文件重构、调试、性能优化）
4. **用户可控**——在设置里把默认模型从 deepseek 换成 o1 就行，Agent Runtime 自动用上更强的模型

### 3.2 Coding Agent 的能力分层（给用户的体验设计）

Nexa 对话中涉及代码的任务，Agent Runtime 的路由逻辑：

```
用户说"帮我写个 XXX"
    │
    ▼
Agent 判断是 coding 任务
    │
    ├─ 自动切换到 "代码助手" 专家
    │     ├─ dispatch_strategy.memory_profile = "full" （代码任务需要更多上下文）
    │     └─ tools: [file_read, file_write, file_edit, bash, web_search]
    │
    └─ ToolDispatcher 里用 pi-coding-agent 的 SDK 执行
          ├─ codingAgent.session({ model: currentModel, workspace: workspacePath })
          ├─ 每个 step: codingAgent.step(toolSpec)
          └─ bash 输出流式推送到 UI
```

### 3.3 当 pi-coding-agent 不够用的 Fallback 策略

有三个补充手段，不需要外接 Codex：

#### (a) 强制切换强模型

```yaml
# 设置里增加一个 "编码任务默认用强模型" 开关
coding:
  useStrongModel: true
  strongModel: "o1-preview"       # 或 "claude-sonnet-4"
  fastModel: "deepseek-chat"     # 其他任务用便宜模型
```

用户开了这个开关后，Agent 检测到 coding 任务 → 自动把 model 切到 strongModel。**核心价值：用户花 0 元额外成本，但代码质量显著提升**。

#### (b) 代码任务的专家预设 dispatch_strategy

```yaml
name: 代码助手
dispatch_strategy:
  max_steps: 30                    # coding 任务允许更多步骤
  step_timeout_seconds: 180        # bash 执行可能较慢
  memory_profile: "full"           # 完整注入记忆
  always_use_strong_model: true    # 专家级配置，强制切强模型
tools:
  - file_read
  - file_write
  - file_edit
  - bash
  - web_search
  - terminal_run
```

#### (c) 内置 Bash + Read/Write/Edit 工具

pi-coding-agent 的 4 个核心工具（read/write/edit/bash）在我们的 **内建工具集里也实现一份**（可以直接从 pi-coding-agent 的源码提取核心逻辑），这样即使不用 coding-agent SDK，普通专家也能跑代码任务。coding-agent SDK 是**可选增强层**。

### 3.4 什么时候才需要外接 Codex CLI（留给未来的信号）

- 市场反馈用户普遍觉得 deepseek-chat 写复杂代码不行，且大量用户愿意额外付费
- 需要**生产级沙箱隔离**（当前 Node 子进程隔离对个人用户足够，但未来如果接多人协作就需要）
- 需要 Codex 独有的能力（Rust 级文件系统隔离 + 浏览器级预览）

目前这三个信号都没有，所以 **v1 不接 Codex CLI**，用"内置 + 强制切强模型"策略。

---

## 4. 具体集成方案

### 4.1 在 pi-agent-core Agent Loop 里嵌入 pi-coding-agent

```typescript
// Agent Runtime 的 ToolDispatcher
class ToolDispatcher {
  private codingAgent: CodingAgentSession | null = null;

  async dispatch(toolName: string, args: any, ctx: Context) {
    // 常规工具直接执行
    if (BASIC_TOOLS.includes(toolName)) {
      return this.runBasicTool(toolName, args, ctx);
    }

    // coding 相关工具走 pi-coding-agent SDK
    if (CODING_TOOLS.includes(toolName)) {
      if (!this.codingAgent) {
        this.codingAgent = await createCodingAgentSession({
          model: ctx.currentModel,
          workspacePath: ctx.workspacePath,
          provider: ctx.modelProvider,   // deepseek / openai / anthropic 任一
          apiKey: ctx.apiKey,
        });
      }
      return this.codingAgent.execute(toolName, args);
    }
  }
}
```

### 4.2 文件编辑安全边界

所有代码写入操作强制：
```typescript
assert(path.startsWith(workspacePath));  // 不能写 workspace 之外
```

bash 执行在独立 Node 子进程里，有超时和内存上限：
```typescript
exec(child, { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 });
```

### 4.3 与右侧产物面板的联动

- bash 输出实时 append 到消息流（Tool Call 折叠展开里可以看到）
- 每次 write/edit 后，右侧产物面板的文件树自动刷新（通过 IPC 通知 UI 层）
- bash 执行的 HTML dev server → 右侧面板的"预览"标签页内嵌浏览器加载

---

## 5. 结论

| 方案 | v1 采用 |
|------|--------|
| pi-coding-agent（内置 SDK） | ✅ **默认方案** |
| 强制切强模型开关 | ✅ 关键补充 |
| Codex CLI 外接 | ❌ 不做，等用户付费意愿和安全需求信号 |

**最终给用户的体验**：
1. 默认用 deepseek-chat，零配置就能写代码（中小规模任务）
2. 一个开关"编码任务用强模型" → 切到 o1-preview / claude sonnet → 代码质量质变
3. 未来要接 Codex CLI 时，只是 ToolDispatcher 里多一个 provider，不影响现有架构
