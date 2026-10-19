# Nexa · 桌面端前端 ↔ Agent 通信技术方案

> 覆盖 IPC 通道定义、Agent 执行时序图、UI 事件处理逻辑、流式输出处理。

---

## 1. 通信架构总览

```
┌──────────────────────────────────────────────────────────────┐
│  UI 层 (React + Zustand)                                      │
│                                                              │
│  消息事件订阅 ──▶ Zustand Store 更新 ──▶ React 组件重渲染       │
│  (onAgentMessage)  (useConversationStore)                     │
│                                                              │
│  用户操作 ──▶ IPC invoke ──▶ 主进程                           │
│  (send/暂停/续跑/删除)  (invokeAgentAction)                    │
└────────────────────────────┬─────────────────────────────────┘
                             │ Electron IPC bridge
                             ▼
┌──────────────────────────────────────────────────────────────┐
│  主进程 (Node.js + Agent Runtime)                              │
│                                                              │
│  Agent Loop 执行中 ──▶ 事件流 ──▶ webContents.send            │
│  (每 step 产出事件)  (event bus)  (推送到渲染进程)              │
│                                                              │
│  接收 IPC invoke ──▶ 路由到 Agent Runtime 方法                  │
│  (例如 session.pause() / session.delete() / session.start())  │
└──────────────────────────────────────────────────────────────┘
```

核心原则：
- **主进程是 Agent 的"真源"**，UI 层是事件驱动的被动消费者
- **所有 Agent 状态变更**都由主进程主动推送给 UI（Event 模式），而不是 UI 轮询
- **用户操作**走单向 IPC invoke（请求-响应），主进程收到后可能触发 Agent Loop 并持续推事件回来

---

## 2. IPC 通道定义

### 2.1 通道命名规范

```
agent:{action}          → 渲染进程 → 主进程（用户操作）
agent:event            → 主进程 → 渲染进程（Agent 推送事件）
```

### 2.2 渲染进程 → 主进程（invoke）

| 通道 | 参数 | 说明 |
|------|------|------|
| `agent:session.create` | `{ initialMessage, mode: 'free'\|'project', projectPath?, model, expertId? }` | 创建新会话并启动 Agent。**mode=free** 系统自动创建 `~/.nexa/workspaces/<id>/`；**mode=project** 绑定用户选的已有目录 |
| `agent:session.send` | `{ sessionId, message }` | 向已有会话发送新消息（续跑） |
| `agent:session.pause` | `{ sessionId }` | 暂停 Agent 执行 |
| `agent:session.resume` | `{ sessionId }` | 恢复执行 |
| `agent:session.delete` | `{ sessionId }` | free 模式删 workspace + 元数据；project 模式只删元数据（不动用户项目目录） |
| `agent:human-response` | `{ sessionId, questionId, choice }` | 用户回应 human-ask 决策 |
| `agent:list` | `{ filter?, search? }` | 列出会话，支持按 status 过滤 + 标题模糊搜索 |
| `agent:session.messages` | `{ sessionId }` | 拉取某会话的完整消息历史 |
| `agent:open-directory-picker` | `{}` | 弹出 Electron 原生目录选择框（project 模式入口用） |

### 2.2.1 笔记子系统 IPC（v1 新增）

| 通道 | 参数 | 说明 |
|------|------|------|
| `note:list` | `{ category?, status?, search? }` | 列出笔记。返回数组，前端按 category 分组渲染 |
| `note:get` | `id` | 拉取单条笔记完整内容 |
| `note:create` | `{ title, status?, category?, tags? }` | 新建空笔记，默认 status=draft |
| `note:update` | `id, { title?, content?, status?, category?, tags? }` | 保存草稿 / 提交（status 变 submitted）/ 编辑 |
| `note:delete` | `id` | 删除笔记 |
| `note:categories` | `{}` | 返回所有分类 + 每个分类下笔记数 |
| `note:addCategory` | `{ name, icon? }` | 新增用户自定义分类 |
| `note:removeCategory` | `id` | 删除分类（笔记 category 置为"未分类"） |
| `note:append` | `id, block: string` | v2 Agent 辅助用：向笔记追加 markdown 块（如"追加 Q3"） |

### 2.3 主进程 → 渲染进程（event 推送）

主进程在 Agent Loop 执行期间，通过 `mainWindow.webContents.send('agent:event', payload)` 持续推送：

```typescript
type AgentEvent =
  // 会话级
  | { type: 'session.created'; sessionId: string; title: string; mode: 'free' | 'project' }
  | { type: 'session.status'; sessionId: string; status: 'running' | 'paused' | 'completed' | 'failed' }
  | { type: 'session.expert-switch'; sessionId: string; from: string; to: string }

  // 消息级
  | { type: 'message.user'; sessionId: string; id: string; content: string; ts: number }
  | { type: 'message.assistant.delta'; sessionId: string; id: string; delta: string }  // 流式 token
  | { type: 'message.assistant.done'; sessionId: string; id: string; content: string; tokenUsage: {...} }

  // Plan / Tool 级
  | { type: 'plan.created'; sessionId: string; steps: PlanStep[] }
  | { type: 'plan.step.update'; sessionId: string; stepIndex: number; status: 'pending' | 'active' | 'done' | 'failed' }
  | { type: 'tool.call'; sessionId: string; toolName: string; args: any; callId: string; ts: number }
  | { type: 'tool.result'; sessionId: string; callId: string; success: boolean; result: any; durationMs: number }

  // Human-ask 阻塞
  | { type: 'human-ask'; sessionId: string; questionId: string; question: string; options: string[] }
  | { type: 'human-ask.resolved'; sessionId: string; questionId: string }

  // 产物
  | { type: 'artifact.created'; sessionId: string; file: { icon, title, desc, size } }
  | { type: 'workspace.files.changed'; sessionId: string }  // 右侧面板文件树刷新

  // 错误
  | { type: 'error'; sessionId?: string; code: string; message: string };
```

### 2.4 preload.js 暴露的 API

```typescript
// preload.ts - 只暴露安全白名单 API
contextBridge.exposeInMainWorld('nexa', {
  // invoke 调用
  sessionCreate: (opts) => ipcRenderer.invoke('agent:session.create', opts),
  sessionSend: (opts) => ipcRenderer.invoke('agent:session.send', opts),
  sessionPause: (id) => ipcRenderer.invoke('agent:session.pause', { sessionId: id }),
  sessionResume: (id) => ipcRenderer.invoke('agent:session.resume', { sessionId: id }),
  sessionDelete: (id) => ipcRenderer.invoke('agent:session.delete', { sessionId: id }),
  humanResponse: (opts) => ipcRenderer.invoke('agent:human-response', opts),
  listSessions: () => ipcRenderer.invoke('agent:list', {}),
  loadMessages: (id) => ipcRenderer.invoke('agent:session.messages', { sessionId: id }),

  // 事件订阅
  onEvent: (handler) => ipcRenderer.on('agent:event', (_e, payload) => handler(payload)),
  offEvent: (handler) => ipcRenderer.removeListener('agent:event', handler),
});
```

---

## 3. 调用时序图：创建会话 → Agent 执行 → 产物

```
React UI                   Zustand Store              Agent Runtime (main)         LLM API
  │                             │                          │                        │
  │── user types + click send ──▶│                          │                        │
  │                             │── createSession() invoke ──▶│                        │
  │                             │                          │── create workspace dir  │
  │                             │                          │── compile system prompt │
  │                             │                          │── LLM call (streaming)──▶│
  │                             │                          │◀── token 1, token 2...  │
  │                             │                          │                        │
  │                             │  onEvent: session.created │                        │
  │◀── re-render sidebar ───────│                          │                        │
  │                             │                          │                        │
  │                             │  onEvent: message.user    │                        │
  │◀── re-render chat list ─────│                          │                        │
  │                             │                          │                        │
  │                             │  onEvent: plan.created   │                        │
  │◀── show plan steps ─────────│                          │                        │
  │                             │                          │                        │
  │                             │  onEvent: plan.step.update(active)                │
  │◀── step highlights ─────────│                          │                        │
  │                             │                          │                        │
  │                             │  onEvent: tool.call       │                        │
  │◀── show collapsible ────────│                          │── execute tool         │
  │                             │                          │   ├─ web_search        │
  │                             │                          │   └─ kb_search         │
  │                             │                          │                        │
  │                             │  onEvent: tool.result     │                        │
  │◀── expand result ───────────│                          │                        │
  │                             │                          │                        │
  │                             │  onEvent: plan.step.update(done)                  │
  │◀── step checkmark ──────────│                          │                        │
  │                             │                          │                        │
  │                             │                          │── LLM call next step ──▶│
  │                             │                          │◀── streaming tokens     │
  │                             │  onEvent: assistant.delta │                       │
  │◀── live text append ────────│   (每 ~50ms 推一次)       │                        │
  │                             │                          │                        │
  │                             │  onEvent: assistant.done  │                        │
  │◀── final render ───────────│                          │                        │
  │                             │                          │                        │
  │                             │  onEvent: artifact.created│                        │
  │◀── refresh artifacts panel──│                          │── write file           │
  │                             │                          │                        │
  │                             │  onEvent: session.status(completed)               │
  │◀── status badge ───────────│                          │                        │
```

---

## 4. UI 事件处理逻辑图

### 4.1 Zustand Store 设计

```typescript
// stores/conversation.ts
interface ConversationState {
  sessions: Record<string, Session>;
  currentSessionId: string | null;

  // event handlers — 所有 agent:event 都进这里
  handleAgentEvent: (evt: AgentEvent) => void;
}

const useConversationStore = create<ConversationState>((set, get) => ({
  sessions: {},
  currentSessionId: null,

  handleAgentEvent: (evt) => {
    switch (evt.type) {
      case 'session.created':
        set(s => ({
          sessions: { ...s.sessions, [evt.sessionId]: { id: evt.sessionId, title: evt.title, messages: [] } }
        }));
        break;

      case 'session.status':
        set(s => ({
          sessions: updateIn(s.sessions, evt.sessionId, { status: evt.status })
        }));
        break;

      case 'message.user':
        set(s => ({
          sessions: appendMessage(s.sessions, evt.sessionId, { role: 'user', ...evt })
        }));
        break;

      case 'message.assistant.delta':
        // 流式 token 增量拼接 — 关键优化：节流，每 ~30ms 合并一次
        throttle(() => {
          set(s => ({
            sessions: appendDelta(s.sessions, evt.sessionId, evt.id, evt.delta)
          }));
        }, 30);
        break;

      case 'message.assistant.done':
        set(s => ({
          sessions: finalizeMessage(s.sessions, evt.sessionId, evt.id, {
            content: evt.content, tokenUsage: evt.tokenUsage
          })
        }));
        break;

      case 'plan.created':
        set(s => ({
          sessions: setPlan(s.sessions, evt.sessionId, { steps: evt.steps })
        }));
        break;

      case 'plan.step.update':
        set(s => ({
          sessions: updatePlanStep(s.sessions, evt.sessionId, evt.stepIndex, evt.status)
        }));
        break;

      case 'tool.call':
        set(s => ({
          sessions: addToolCall(s.sessions, evt.sessionId, { callId: evt.callId, ...evt })
        }));
        break;

      case 'tool.result':
        set(s => ({
          sessions: resolveToolCall(s.sessions, evt.sessionId, evt.callId, {
            success: evt.success, result: evt.result, durationMs: evt.durationMs
          })
        }));
        break;

      case 'human-ask':
        set(s => ({
          sessions: setHumanAsk(s.sessions, evt.sessionId, { questionId: evt.questionId, ...evt })
        }));
        break;

      case 'human-ask.resolved':
        set(s => ({
          sessions: clearHumanAsk(s.sessions, evt.sessionId, evt.questionId)
        }));
        break;

      case 'artifact.created':
        // 触发产物面板刷新（可单独 store，也可放 session.metadata）
        eventBus.emit('artifacts:refresh', evt.sessionId);
        break;

      case 'session.expert-switch':
        set(s => ({
          sessions: updateIn(s.sessions, evt.sessionId, { currentExpert: evt.to })
        }));
        break;
    }
  },
}));
```

### 4.2 UI 组件订阅模式

```typescript
// ConversationView.tsx — 消息列表
function ConversationView() {
  const currentSession = useConversationStore(s => s.sessions[s.currentSessionId]);

  return (
    <div className="message-list">
      {currentSession?.messages.map(msg => {
        if (msg.role === 'user') return <UserBubble />;
        if (msg.role === 'assistant' && msg.streaming) return <StreamingAssistantBubble text={msg.text} />;
        if (msg.role === 'assistant') return <AssistantBubble content={msg.content} />;
        if (msg.role === 'plan') return <PlanView steps={msg.steps} />;
        if (msg.role === 'tool') return <ToolCallView state={msg} />;
        if (msg.role === 'human-ask') return <HumanAskView question={msg} />;
        if (msg.role === 'expert-switch') return <ExpertSwitchBanner to={msg.to} />;
      })}
    </div>
  );
}

// 流式 textarea 效果：用 useState + throttle 避免每 token 重渲染整个列表
function StreamingAssistantBubble({ text }) {
  return (
    <div className="bg-white border border-border rounded-xl px-4 py-3 prose-custom">
      {text}<span className="typing-cursor animate-pulse">▌</span>
    </div>
  );
}
```

### 4.3 UI 事件 → Agent 动作流程

```
┌─────────────────────────────────────────────────────────────────┐
│ 用户在 UI 上做的操作                                            │
│                                                                 │
│ 点击"发送" ──▶ onSend() ──▶ nexa.sessionCreate({message,model}) │
│                                                                 │
│ 点击"暂停" ──▶ onPause() ──▶ nexa.sessionPause(sessionId)      │
│                                                                 │
│ 点击"删除" ──▶ confirm() ──▶ nexa.sessionDelete(sessionId)      │
│                 (删除前弹出 confirm: "确定删除？工作目录也会清理") │
│                                                                 │
│ 点击 human-ask 选项 ──▶ nexa.humanResponse({sessionId,choice}) │
│                                                                 │
│ 切换专家（顶部 bar 下拉） ──▶ 注入新 system prompt + tools 白名单  │
│                                 │                              │
│                                 └── 下一轮 LLM call 生效        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. 流式输出处理

### 5.1 主进程侧

```typescript
// 主进程 Agent Runtime 里，LLM 调用用 streaming=true
async function callLLMStream(messages, onToken) {
  const stream = await client.chat.completions.create({
    model: currentModel,
    messages,
    stream: true,
  });

  let buffer = '';
  let lastFlush = Date.now();

  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content || '';
    buffer += token;

    // 节流：每 30ms 推一次 event，避免高频 IPC 卡顿
    if (Date.now() - lastFlush > 30 && buffer.length > 0) {
      mainWindow.webContents.send('agent:event', {
        type: 'message.assistant.delta',
        sessionId,
        id: currentMessageId,
        delta: buffer,
      });
      buffer = '';
      lastFlush = Date.now();
    }
  }

  // 最后把残余推过去 + done 事件
  mainWindow.webContents.send('agent:event', {
    type: 'message.assistant.done',
    sessionId, id: currentMessageId,
    content: fullText, tokenUsage: {...}
  });
}
```

### 5.2 渲染进程侧

```typescript
// delta 合并用 useRef 暂存，避免每 token 触发 setState
const streamingTextRef = useRef('');
const lastFlushRef = useRef(Date.now());

function onDelta(evt) {
  streamingTextRef.current += evt.delta;
  if (Date.now() - lastFlushRef.current > 30) {
    setDisplayText(streamingTextRef.current);   // 批量 setState
    lastFlushRef.current = Date.now();
  }
}

function onDone(evt) {
  setDisplayText(evt.content);  // 最终完整内容覆盖
}
```

---

## 6. Human-Ask 阻塞与恢复

这是交互最复杂的场景——Agent 在执行中暂停，UI 必须感知并渲染决策卡片：

```
时间线:
  t=0s  Agent 执行到某步 → 判断需要用户决策
  t=1s  主进程发送 event: { type: 'human-ask', question, options }
  t=2s  UI 渲染决策卡片（带 loading 光标）
  t=3s  同 event 通过 RelayClient 推送到手机端 WebSocket
  t=4s  用户在 UI 上点击选项 → invoke humanResponse
  t=5s  主进程收到 response → agent.loop.resumeWith(choice)
  t=6s  主进程继续 LLM call → 继续推 delta tokens
```

---

## 7. 错误处理策略

| 错误类型 | 主进程行为 | UI 行为 |
|---------|-----------|--------|
| LLM API key 无效 | 发送 event `error` + 写入 session 日志 | toast 提示 + 打开设置页面 |
| Agent Loop 超时 | session.status = 'failed' + event | 显示"已超时" + 提供"重新运行"按钮 |
| bash 命令失败 | tool.result.success=false + event | Tool Call 折叠项里显示红色错误 |
| 网络断开 | RelayClient 重连 + 本地队列 | 顶部提示条"网络已断开，本地继续执行" |
| 会话删除时还在 running | 先发送 session.stop 等确认 → 再清文件 → event | UI 淡出动画 + Sidebar 移除该项 |

---

## 8. 为什么不用更简单的方案

| 方案 | 为什么不用 |
|------|-----------|
| 全量轮询 session 状态 | 浪费资源 + 有延迟感，Agent Loop 本身就是事件驱动的，推送是天然选择 |
| HTTP REST + SSE | Electron 主进程里 HTTP 不必要，IPC 更轻量高效 |
| 把 Agent 放渲染进程 | 违反 Electron 安全最佳实践；而且文件系统操作需要主进程权限 |
| Redux / MobX | Zustand 足够，轻量，对 Event 模式更贴合 |
