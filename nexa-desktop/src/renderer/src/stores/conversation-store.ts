/**
 * 会话状态管理 —— 主进程 AgentEvent 推送到此 store，UI 订阅重渲染
 *
 * 设计来源: docs/frontend-agent-comm.md §4.1 handleAgentEvent
 * 事件节流: runtime 推送侧已做 30ms 节流，本 store 侧 delta 合并用 useRef + flush 进一步稳定
 */
import { create } from "zustand"
import type { AgentEvent, AttachmentInput, ChatAttachment, SessionListItem, SessionMode, SessionStatus } from "@shared/ipc-channels"
import { useArtifactsStore } from "@renderer/stores/artifacts-store"

// ==========================================
// 数据结构（前端视角，与 runtime 推的 AgentEvent 对齐）
// ==========================================

/** 会话列表项（侧边栏展示） */
export interface SessionItem {
  id: string
  title: string
  mode: SessionMode
  status: SessionStatus
  projectPath: string | null
  createdAt: number
  updatedAt: number
  /** 当前选中的模型字符串 provider/modelId */
  model: string
  /** 当前专家 id */
  currentExpert?: string | null
  /** 是否已归档 */
  archived: boolean
}

/** 任务轨迹元数据（一次用户消息触发的一轮 agent loop） */
export interface AgentRunInfo {
  id: string
  status: "running" | "completed" | "failed" | "paused"
  startedAt: number
  durationMs?: number
  toolCallCount: number
}

/** 消息气泡 —— assistant 流式中 text 可能分多次 delta 追加 */
export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "tool" | "plan" | "error"
  content: string
  /** 所属 agent run（assistant/tool 消息）；用于任务轨迹分组收拢 */
  runId?: string | null
  /** 用户消息图片附件（已落盘）；assistant/tool 消息为 undefined */
  attachments?: ChatAttachment[]
  /** tool 调用的结构化信息 */
  toolCall?: {
    callId: string
    toolName: string
    args: unknown
    success?: boolean
    result?: unknown
    durationMs?: number
  }
  /** plan 步骤 */
  plan?: { steps: { id: string; description: string; status: string }[] }
  /** assistant 思考过程（reasoning 模型）；与正文同属一条消息 */
  thinking?: string
  /** 思考流式中为 true（正文 delta 到来/done 后转 false） */
  thinkingStreaming?: boolean
  createdAt: number
  /** 流式中为 true，done 后变 false */
  streaming?: boolean
  /** assistant token 用量 */
  usage?: { input?: number; output?: number; totalTokens?: number } | null
  /** assistant 使用的模型标识 provider/modelId */
  model?: string
}

/** 完整会话（聊天主区用） */
export interface Conversation {
  id: string
  title: string
  mode: SessionMode
  status: SessionStatus
  /** 创建时使用的模型 */
  model: string
  /** 当前专家 id */
  currentExpert: string | null
  /** project 模式绑定的用户项目目录；free 为 null */
  projectPath: string | null
  messages: ChatMessage[]
  /** 任务轨迹元数据（runId → info），用于渲染「任务耗时」收拢摘要条 */
  runs: Record<string, AgentRunInfo>
}

// ==========================================
// Store
// ==========================================

interface ConversationState {
  /** 所有会话 Map（含侧边栏列表的 + 已打开详情的） */
  sessions: Record<string, Conversation>
  currentSessionId: string | null
  /** 侧边栏列表（独立于 sessions Map，支持分组/搜索/筛选） */
  sessionList: SessionItem[]
  listLoaded: boolean
  /** 用户当前选中的默认模型（跨会话，用于 createSession） */
  currentModel: string
  /** 可选模型列表（从 settings.json 读） */
  availableModels: { id: string; displayName: string; provider: string; modelId: string; supportsImage?: boolean }[]
  /** 实际可用的 provider（已启用且有 API key，主进程按 getApiKey 判定）—— 会话内模型下拉只展示这些 provider 的模型 */
  usableProviders: string[]
  /** 从项目分组列表中软隐藏的 projectPath（绝对路径） */
  hiddenProjectPaths: string[]
  /** 从侧边栏项目分组点「新建任务」注入，WelcomeView mount 时读取后清掉 */
  pendingProjectPath: string | null
  /** 从技能包专家管理页点「新建专家」注入，WelcomeView mount 时读取后清掉 */
  pendingSkillId: string | null
  pendingPrompt: string | null

  // ==== Action ====
  /** 从主进程拉取会话列表（未归档 + 已归档合并，侧边栏按归档分组展示） */
  fetchList: () => Promise<void>
  /** 切换当前会话（从主进程加载历史消息） */
  selectSession: (id: string) => Promise<void>
  /** 收到 AgentEvent 的统一入口 */
  handleAgentEvent: (evt: AgentEvent) => void
  /** 创建新会话（Welcome 页的 ModeCard 点击） */
  createSession: (opts: { initialMessage: string; mode: SessionMode; model: string; projectPath?: string; expertId?: string; attachments?: AttachmentInput[] }) => Promise<string>
  /** 继续发消息 */
  sendMessage: (sessionId: string, message: string, attachments?: AttachmentInput[]) => Promise<boolean>
  /** 暂停/恢复 */
  pauseSession: (sessionId: string) => Promise<void>
  resumeSession: (sessionId: string) => Promise<void>
  /** 删除 */
  deleteSession: (sessionId: string) => Promise<void>
  /** 重命名 */
  renameSession: (sessionId: string, title: string) => Promise<boolean>
  /** 归档/取消归档 */
  archiveSession: (sessionId: string, archived: boolean) => Promise<void>
  /** 打开会话所在文件夹 */
  revealSession: (sessionId: string) => Promise<void>
  /** 设置当前默认模型 */
  setCurrentModel: (model: string) => void
  /** 初始化默认模型（从 settings.json 读） */
  initDefaultModel: () => Promise<void>
  /** 设置 pendingProjectPath（从侧边栏分组菜单跳转 WelcomeView 用） */
  setPendingProjectPath: (path: string | null) => void
  /** 设置 pendingSkillId + pendingPrompt（从技能包专家页跳转 WelcomeView 用） */
  setPendingExpertCreate: (skillId: string | null, prompt: string | null) => void
  /** 软隐藏一个项目路径（持久化到 settings.json） */
  hideProject: (path: string) => Promise<void>
  /** 取消隐藏（后续扩展用，暂时保留） */
  unhideProject: (path: string) => Promise<void>
}

/** 30ms delta 节流窗口 */
const DELTA_FLUSH_MS = 30

/** 节流工具 */
function throttle<T extends (...args: unknown[]) => void>(fn: T, wait: number): T {
  let lastRun = 0
  let timeout: ReturnType<typeof setTimeout> | null = null
  return ((...args: unknown[]) => {
    const now = Date.now()
    const remaining = wait - (now - lastRun)
    if (remaining <= 0) {
      if (timeout) { clearTimeout(timeout); timeout = null }
      lastRun = now
      fn(...args)
    } else if (!timeout) {
      timeout = setTimeout(() => {
        lastRun = Date.now()
        timeout = null
        fn(...args)
      }, remaining)
    }
  }) as T
}

/** 更新 sessions Map 中指定会话 */
function updateConversation(
  sessions: Record<string, Conversation>,
  id: string,
  updater: (conv: Conversation) => Conversation
): Record<string, Conversation> {
  const conv = sessions[id]
  if (!conv) return sessions
  return { ...sessions, [id]: updater(conv) }
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  sessions: {},
  currentSessionId: null,
  sessionList: [],
  listLoaded: false,
  currentModel: "deepseek/deepseek-v4-pro",
  availableModels: [],
  usableProviders: [],
  hiddenProjectPaths: [],
  pendingProjectPath: null,
  pendingSkillId: null,
  pendingPrompt: null,

  // ---- 拉列表（未归档 + 已归档合并，顺带拉隐藏项目路径） ----
  fetchList: async () => {
    if (typeof window === "undefined" || !window.nexa) return
    const [[active, archived], settings] = (await Promise.all([
      Promise.all([
        window.nexa.listSessions({ archived: false }),
        window.nexa.listSessions({ archived: true }),
      ]),
      window.nexa.getSettings().catch(() => ({})) as Promise<{ hiddenProjectPaths?: string[] }>,
    ])) as [[SessionListItem[], SessionListItem[]], { hiddenProjectPaths?: string[] }]
    const toItem = (s: SessionListItem): SessionItem => ({
      id: s.id,
      title: s.title,
      mode: s.mode,
      status: s.status,
      projectPath: s.projectPath,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      model: s.model,
      currentExpert: s.currentExpert,
      archived: s.archived,
    })
    const hidden = Array.isArray(settings?.hiddenProjectPaths) ? settings.hiddenProjectPaths : []
    set({
      sessionList: [...active.map(toItem), ...archived.map(toItem)],
      listLoaded: true,
      hiddenProjectPaths: hidden,
    })
  },

  // ---- 选中会话，加载历史 ----
  selectSession: async (id) => {
    set({ currentSessionId: id })
    const state = get()
    // 产物面板联动: 切换会话时清空旧会话的树/选中文件/展开目录，再加载新会话文件树
    useArtifactsStore.getState().clear()
    void useArtifactsStore.getState().fetchTree(id).catch(() => {})
    if (state.sessions[id]) return // 已加载
    if (typeof window === "undefined" || !window.nexa) return
    try {
      const [rawMsgs, rawRuns] = await Promise.all([
        window.nexa.loadMessages(id) as Promise<Array<{ id: string; role: string; content: string; thinking?: string | null; run_id?: string | null; attachments?: ChatAttachment[] | null; tool_name: string | null; tool_call_id: string | null; created_at: number; model?: string | null; token_usage: { input?: number; output?: number; cost?: number; totalTokens?: number } | null }>>,
        window.nexa.sessionRuns(id) as Promise<Array<{ id: string; status: AgentRunInfo["status"]; started_at: number; duration_ms: number | null; tool_call_count: number }>>,
      ])
      const messages: ChatMessage[] = rawMsgs.map((m) => {
        const base: ChatMessage = {
          id: m.id,
          role: m.role as ChatMessage["role"],
          content: m.content,
          thinking: m.thinking ?? undefined,
          runId: m.run_id ?? null,
          attachments: m.attachments ?? undefined,
          createdAt: m.created_at * 1000,
          usage: m.token_usage ?? null,
          model: m.model ?? undefined,
        }
        // tool role: content 是 { args, result, success, durationMs } JSON
        if (m.role === "tool") {
          let parsed: { args?: unknown; result?: unknown; success?: boolean; durationMs?: number | null } = {}
          try { parsed = JSON.parse(m.content) } catch {}
          base.role = "tool"
          base.toolCall = {
            toolName: m.tool_name ?? "unknown",
            callId: m.tool_call_id ?? m.id,
            args: parsed.args ?? {},
            result: parsed.result,
            success: parsed.success ?? true,
            durationMs: parsed.durationMs ?? undefined,
          }
          base.content = "" // tool 消息的 content 是元数据 JSON，不展示
        }
        return base
      })
      const runs: Record<string, AgentRunInfo> = {}
      for (const r of rawRuns) {
        runs[r.id] = {
          id: r.id,
          status: r.status,
          startedAt: r.started_at,
          durationMs: r.duration_ms ?? undefined,
          toolCallCount: r.tool_call_count,
        }
      }
      const listItem = state.sessionList.find((s) => s.id === id)
      const conv: Conversation = {
        id,
        title: listItem?.title ?? "",
        mode: listItem?.mode ?? "free",
        status: listItem?.status ?? "paused",
        model: listItem?.model ?? "",
        currentExpert: listItem?.currentExpert ?? null,
        projectPath: listItem?.projectPath ?? null,
        messages,
        runs,
      }
      set((s) => ({ sessions: { ...s.sessions, [id]: conv } }))
    } catch {
      // loadMessages 还未在 main 侧持久化 message，先建空壳
      const listItem = state.sessionList.find((s) => s.id === id)
      const conv: Conversation = {
        id,
        title: listItem?.title ?? "",
        mode: listItem?.mode ?? "free",
        status: listItem?.status ?? "paused",
        model: listItem?.model ?? "",
        currentExpert: listItem?.currentExpert ?? null,
        projectPath: listItem?.projectPath ?? null,
        messages: [],
        runs: {},
      }
      set((s) => ({ sessions: { ...s.sessions, [id]: conv } }))
    }
  },

  // ---- 创建会话 ----
  createSession: async ({ initialMessage, mode, model, projectPath, expertId, attachments }) => {
    if (typeof window === "undefined" || !window.nexa) throw new Error("nexa API 不可用")
    const res = await window.nexa.sessionCreate({
      initialMessage,
      mode,
      model,
      projectPath,
      expertId,
      attachments,
    })
    const state = get()
    set((s) => ({
      sessionList: [
        {
          id: res.sessionId,
          title: initialMessage.slice(0, 40) || "新任务",
          mode,
          status: "running",
          projectPath: projectPath ?? null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          model,
          archived: false,
        },
        ...s.sessionList,
      ],
    }))
    // 等 Agent Loop 推第一个 message.user 事件时再填充，这里仅切换 currentSessionId
    set({ currentSessionId: res.sessionId })
    // 预先建空壳，避免 selectSession 找不到
    if (!state.sessions[res.sessionId]) {
      set((s) => ({
        sessions: {
          ...s.sessions,
          [res.sessionId]: {
            id: res.sessionId,
            title: initialMessage.slice(0, 40) || "新任务",
            mode,
            status: "running",
            model,
            currentExpert: expertId ?? "builtin:general",
            projectPath: projectPath ?? null,
            messages: [],
            runs: {},
          },
        },
      }))
    }
    return res.sessionId
  },

  sendMessage: async (sessionId, message, attachments) => {
    if (typeof window === "undefined" || !window.nexa) return false
    return window.nexa.sessionSend({ sessionId, message, attachments })
  },

  pauseSession: async (sessionId) => {
    if (typeof window === "undefined" || !window.nexa) return
    await window.nexa.sessionPause(sessionId)
  },

  resumeSession: async (sessionId) => {
    if (typeof window === "undefined" || !window.nexa) return
    await window.nexa.sessionResume(sessionId)
  },

  deleteSession: async (sessionId) => {
    if (typeof window === "undefined" || !window.nexa) return
    await window.nexa.sessionDelete(sessionId)
    // 产物面板联动: 会话删除后清空文件树
    if (get().currentSessionId === sessionId) useArtifactsStore.getState().clear()
    set((s) => {
      const { [sessionId]: _removed, ...restSessions } = s.sessions
      return {
        sessions: restSessions,
        sessionList: s.sessionList.filter((x) => x.id !== sessionId),
        currentSessionId: s.currentSessionId === sessionId ? null : s.currentSessionId,
      }
    })
  },

  // ---- 重命名 ----
  renameSession: async (sessionId, title) => {
    if (typeof window === "undefined" || !window.nexa) return false
    const trimmed = title.trim()
    if (!trimmed) return false
    const ok = (await window.nexa.sessionRename({ sessionId, title: trimmed })) as boolean
    if (ok) {
      set((s) => ({
        sessionList: s.sessionList.map((x) => (x.id === sessionId ? { ...x, title: trimmed } : x)),
        // 右侧会话头部（Topbar）读取 sessions[id].title，需同步更新
        sessions: s.sessions[sessionId]
          ? { ...s.sessions, [sessionId]: { ...s.sessions[sessionId], title: trimmed } }
          : s.sessions,
      }))
    }
    return ok
  },

  // ---- 归档 / 取消归档 ----
  archiveSession: async (sessionId, archived) => {
    if (typeof window === "undefined" || !window.nexa) return
    await window.nexa.sessionArchive({ sessionId, archived })
    // 列表合并展示: 仅更新归档标记，任务行在「归档任务」分组与主列表间移动
    set((s) => ({
      sessionList: s.sessionList.map((x) => (x.id === sessionId ? { ...x, archived } : x)),
    }))
  },

  // ---- 打开会话文件夹 ----
  revealSession: async (sessionId) => {
    if (typeof window === "undefined" || !window.nexa) return
    await window.nexa.sessionReveal(sessionId)
  },

  setCurrentModel: (model) => {
    set({ currentModel: model })
  },

  initDefaultModel: async () => {
    if (typeof window === "undefined" || !window.nexa) return
    try {
      const res = (await window.nexa.getSettings()) as { defaultModel: string; availableModels: { id: string; displayName: string; provider: string; modelId: string; supportsImage?: boolean }[]; usableProviders?: string[] }
      set({
        currentModel: res?.defaultModel || "deepseek/deepseek-v4-pro",
        availableModels: res?.availableModels ?? [],
        usableProviders: res?.usableProviders ?? [],
      })
    } catch {
      // 忽略，保持默认值
    }
  },

  setPendingProjectPath: (path) => {
    set({ pendingProjectPath: path })
  },

  setPendingExpertCreate: (skillId, prompt) => {
    set({ pendingSkillId: skillId, pendingPrompt: prompt })
  },

  hideProject: async (path) => {
    if (typeof window === "undefined" || !window.nexa) return
    const trimmed = path.replace(/\/+$/, "")
    const current = get().hiddenProjectPaths
    if (current.includes(trimmed)) return
    const next = [...current, trimmed]
    try {
      await window.nexa.setSettings({ hiddenProjectPaths: next })
      set({ hiddenProjectPaths: next })
    } catch {
      // 持久化失败时不切本地状态，避免 UI 与磁盘不一致
    }
  },

  unhideProject: async (path) => {
    if (typeof window === "undefined" || !window.nexa) return
    const trimmed = path.replace(/\/+$/, "")
    const current = get().hiddenProjectPaths
    if (!current.includes(trimmed)) return
    const next = current.filter((p) => p !== trimmed)
    try {
      await window.nexa.setSettings({ hiddenProjectPaths: next })
      set({ hiddenProjectPaths: next })
    } catch {
      // ignore
    }
  },

  // ==========================================
  // handleAgentEvent —— 事件桥接核心
  // ==========================================
  handleAgentEvent: (evt) => {
    const state = get()

    switch (evt.type) {
      case "message.user": {
        const sessId = evt.sessionId
        const msg: ChatMessage = {
          id: evt.id,
          role: "user",
          content: evt.content,
          attachments: evt.attachments,
          createdAt: evt.ts,
        }
        set((s) => ({
          sessions: updateConversation(s.sessions, sessId, (c) => ({
            ...c,
            messages: [...c.messages, msg],
          })),
        }))
        break
      }

      case "message.thinking.delta": {
        const sessId = evt.sessionId
        // thinking 与正文共用节流通道：先写入 pending，再 flush
        const pending = pendingDelta.get(sessId) ?? { text: "", thinking: "" }
        pending.thinking += evt.delta
        pendingDelta.set(sessId, pending)
        scheduleDeltaFlush()
        break
      }

      case "message.assistant.delta": {
        const sessId = evt.sessionId
        // 用节流合并 delta —— 先写入 pending，再 flush
        // 注意: 这里用闭包引用 set，避免 zustand 每次 delta 都全量 setState
        const pending = pendingDelta.get(sessId) ?? { text: "", thinking: "" }
        pending.text += evt.delta
        pendingDelta.set(sessId, pending)
        scheduleDeltaFlush()
        break
      }

      case "message.assistant.done": {
        const sessId = evt.sessionId
        // 先 flush 掉剩余 delta
        flushPendingDelta()
        set((s) => {
          const conv = s.sessions[sessId]
          if (!conv) return s
          // 找最后一条 streaming 的 assistant（含思考中消息），用 done 的完整内容 finalize 它
          const msgs = [...conv.messages]
          const lastStreamingIdx = msgs.reduce(
            (acc, m, i) => (m.role === "assistant" && m.streaming ? i : acc),
            -1
          )
          if (lastStreamingIdx >= 0) {
            msgs[lastStreamingIdx] = {
              ...msgs[lastStreamingIdx],
              content: evt.content,
              thinking: evt.thinking ?? msgs[lastStreamingIdx].thinking,
              runId: msgs[lastStreamingIdx].runId ?? activeRunBySession.get(sessId) ?? null,
              thinkingStreaming: false,
              streaming: false,
              id: evt.id, // 用 runtime 的真实 ID 覆盖
              usage: evt.usage ?? msgs[lastStreamingIdx].usage,
              model: evt.model ?? msgs[lastStreamingIdx].model,
            }
          } else {
            // 没有 streaming 消息（可能 delta 都被 flush 完了），直接新增
            msgs.push({
              id: evt.id,
              role: "assistant" as const,
              content: evt.content,
              thinking: evt.thinking,
              runId: activeRunBySession.get(sessId) ?? null,
              streaming: false,
              createdAt: Date.now(),
              usage: evt.usage,
              model: evt.model,
            })
          }
          return {
            sessions: updateConversation(s.sessions, sessId, (c) => ({ ...c, messages: msgs })),
          }
        })
        break
      }

      case "session.title": {
        const sessId = evt.sessionId
        set((s) => {
          let nextSessions = s.sessions
          if (nextSessions[sessId]) {
            nextSessions = updateConversation(nextSessions, sessId, (c) => ({ ...c, title: evt.title }))
          }
          const nextList = s.sessionList.map((x) => (x.id === sessId ? { ...x, title: evt.title } : x))
          return { sessions: nextSessions, sessionList: nextList }
        })
        break
      }

      case "session.status": {
        const sessId = evt.sessionId
        set((s) => {
          // 更新 sessions Map
          let nextSessions = s.sessions
          if (nextSessions[sessId]) {
            nextSessions = updateConversation(nextSessions, sessId, (c) => ({ ...c, status: evt.status }))
          }
          // 更新侧边栏列表
          const listIdx = s.sessionList.findIndex((x) => x.id === sessId)
          const nextList = listIdx >= 0
            ? s.sessionList.map((x, i) => i === listIdx ? { ...x, status: evt.status, updatedAt: Date.now() } : x)
            : s.sessionList
          return { sessions: nextSessions, sessionList: nextList }
        })
        break
      }

      case "run.started": {
        const sessId = evt.sessionId
        activeRunBySession.set(sessId, evt.runId)
        set((s) => {
          const conv = s.sessions[sessId]
          if (!conv) return s
          const info: AgentRunInfo = { id: evt.runId, status: "running", startedAt: evt.ts, toolCallCount: 0 }
          return {
            sessions: updateConversation(s.sessions, sessId, (c) => ({ ...c, runs: { ...c.runs, [evt.runId]: info } })),
          }
        })
        break
      }

      case "run.finished": {
        const sessId = evt.sessionId
        activeRunBySession.delete(sessId)
        set((s) => {
          const conv = s.sessions[sessId]
          if (!conv) return s
          const prev = conv.runs[evt.runId]
          const info: AgentRunInfo = {
            id: evt.runId,
            status: evt.status,
            startedAt: prev?.startedAt ?? Date.now() - evt.durationMs,
            durationMs: evt.durationMs,
            toolCallCount: evt.toolCallCount,
          }
          return {
            sessions: updateConversation(s.sessions, sessId, (c) => ({ ...c, runs: { ...c.runs, [evt.runId]: info } })),
          }
        })
        break
      }

      case "session.expert-switch": {
        const sessId = evt.sessionId
        set((s) => {
          let nextSessions = s.sessions
          if (nextSessions[sessId]) {
            nextSessions = updateConversation(nextSessions, sessId, (c) => ({ ...c, currentExpert: evt.to }))
          }
          const nextList = s.sessionList.map((x) => (x.id === sessId ? { ...x, currentExpert: evt.to } : x))
          return { sessions: nextSessions, sessionList: nextList }
        })
        break
      }

      case "session.model-switch": {
        const sessId = evt.sessionId
        set((s) => {
          let nextSessions = s.sessions
          if (nextSessions[sessId]) {
            nextSessions = updateConversation(nextSessions, sessId, (c) => ({ ...c, model: evt.model }))
          }
          const nextList = s.sessionList.map((x) => (x.id === sessId ? { ...x, model: evt.model } : x))
          return { sessions: nextSessions, sessionList: nextList, currentModel: evt.model }
        })
        break
      }

      case "tool.call": {
        const sessId = evt.sessionId
        set((s) => {
          const conv = s.sessions[sessId]
          if (!conv) return s
          const msg: ChatMessage = {
            id: `tool-${evt.callId}`,
            role: "tool",
            content: "",
            runId: activeRunBySession.get(sessId) ?? null,
            toolCall: { callId: evt.callId, toolName: evt.toolName, args: evt.args },
            createdAt: evt.ts,
          }
          return { sessions: updateConversation(s.sessions, sessId, (c) => ({ ...c, messages: [...c.messages, msg] })) }
        })
        break
      }

      case "tool.result": {
        const sessId = evt.sessionId
        set((s) => {
          const conv = s.sessions[sessId]
          if (!conv) return s
          const msgs = conv.messages.map((m) => {
            if (m.toolCall?.callId === evt.callId) {
              return {
                ...m,
                toolCall: { ...m.toolCall, success: evt.success, result: evt.result, durationMs: evt.durationMs },
              }
            }
            return m
          })
          return { sessions: updateConversation(s.sessions, sessId, (c) => ({ ...c, messages: msgs })) }
        })
        // 产物面板联动: 工具执行成功可能产生/修改了文件，刷新文件树
        if (evt.success) useArtifactsStore.getState().refreshIfCurrent(sessId)
        break
      }

      case "error": {
        const sessId = evt.sessionId
        if (!sessId) break
        set((s) => {
          const conv = s.sessions[sessId]
          if (!conv) return s
          const msg: ChatMessage = {
            id: `err-${evt.code}-${Date.now()}`,
            role: "error",
            content: evt.message,
            createdAt: Date.now(),
          }
          return { sessions: updateConversation(s.sessions, sessId, (c) => ({ ...c, messages: [...c.messages, msg] })) }
        })
        break
      }

      case "plan.created": {
        const sessId = evt.sessionId
        set((s) => {
          const conv = s.sessions[sessId]
          if (!conv) return s
          const msg: ChatMessage = {
            id: `plan-${sessId}-${Date.now()}`,
            role: "plan",
            content: "",
            plan: { steps: evt.steps },
            createdAt: Date.now(),
          }
          return { sessions: updateConversation(s.sessions, sessId, (c) => ({ ...c, messages: [...c.messages, msg] })) }
        })
        break
      }

      case "plan.step.update": {
        const sessId = evt.sessionId
        set((s) => {
          const conv = s.sessions[sessId]
          if (!conv) return s
          const msgs = conv.messages.map((m) => {
            if (m.role === "plan" && m.plan) {
              const steps = [...m.plan.steps]
              if (steps[evt.stepIndex]) {
                steps[evt.stepIndex] = { ...steps[evt.stepIndex], status: evt.status }
              }
              return { ...m, plan: { steps } }
            }
            return m
          })
          return { sessions: updateConversation(s.sessions, sessId, (c) => ({ ...c, messages: msgs })) }
        })
        break
      }

      default:
        break
    }
  },
}))

// ==========================================
// Delta 节流机制（模块级）
// ==========================================
// pendingDelta: sessionId → 累积的 { 正文, 思考 } delta
const pendingDelta = new Map<string, { text: string; thinking: string }>()
let deltaFlushTimer: ReturnType<typeof setTimeout> | null = null
/** 各会话当前运行中的 runId（同一会话同时只允许一个 run），消息事件据此打 runId */
const activeRunBySession = new Map<string, string>()

function scheduleDeltaFlush() {
  if (deltaFlushTimer) return
  deltaFlushTimer = setTimeout(() => {
    deltaFlushTimer = null
    flushPendingDelta()
  }, DELTA_FLUSH_MS)
}

function flushPendingDelta() {
  if (pendingDelta.size === 0) return
  const toFlush = new Map(pendingDelta)
  pendingDelta.clear()
  // 用 getState 拿最新 sessions Map，避免闭包陈旧
  const { sessions } = useConversationStore.getState()
  let changed = false
  const nextSessions: Record<string, Conversation> = { ...sessions }
  for (const [sessId, { text, thinking }] of toFlush) {
    const conv = nextSessions[sessId]
    if (!conv) continue
    const msgs = [...conv.messages]
    // 找最后一条 assistant：思考/正文流可续写（streaming）时追加，否则新开一条
    const lastIdx = msgs.reduce((acc, m, i) => (m.role === "assistant" ? i : acc), -1)
    const last = lastIdx >= 0 ? msgs[lastIdx] : undefined
    const canAppend = last !== undefined && (last.streaming || last.thinkingStreaming === true)
    if (canAppend && last) {
      const next: ChatMessage = { ...last }
      if (thinking) {
        next.thinking = (next.thinking ?? "") + thinking
        next.thinkingStreaming = !text // 正文 delta 到来即思考结束
      }
      if (text) {
        next.content = next.content + text
        next.streaming = true
        next.thinkingStreaming = false
      }
      msgs[lastIdx] = next
    } else if (thinking || text) {
      msgs.push({
        id: `assistant-streaming-${sessId}-${Date.now()}`,
        role: "assistant",
        content: text,
        thinking: thinking || undefined,
        runId: activeRunBySession.get(sessId) ?? null,
        streaming: true,
        thinkingStreaming: Boolean(thinking) && !text,
        createdAt: Date.now(),
      })
    }
    nextSessions[sessId] = { ...conv, messages: msgs }
    changed = true
  }
  if (changed) {
    useConversationStore.setState({ sessions: nextSessions })
  }
}
