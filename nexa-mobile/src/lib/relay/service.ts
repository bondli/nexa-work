/**
 * 中继客户端单例 + Zustand 状态
 */
import { create } from "zustand"
import { RelayClient, type RelayStatus } from "./client"
import type { AgentEvent, ChatMessage, LibrarySearchResult, SessionSummary } from "./protocol"
import { getDeviceIdentity, storage } from "./storage"
import { LIBRARY_SEARCH, SESSION_LIST, SESSION_MESSAGES, SESSION_SEND, TASK_CREATE } from "./protocol"

let client: RelayClient | null = null

export async function initRelayService(): Promise<void> {
  if (client) return
  const identity = await getDeviceIdentity()
  const relayUrl = (await storage.getRelayUrl()) ?? ""
  const token = (await storage.getToken()) ?? undefined
  client = new RelayClient({
    relayUrl,
    deviceId: identity.deviceId,
    name: identity.name,
    token,
  })
  client.onStatus((s) => useRelayStore.getState().setStatus(s))
  client.onAgentEvent((e) => useRelayStore.getState().handleAgentEvent(e))
  if (relayUrl) void client.start()
}

export function getRelayClient(): RelayClient | null {
  return client
}

/** 由配对页在首次配对成功后调用，注入 token 并启动 */
export async function startRelayWithPairing(relayUrl: string, code: string): Promise<void> {
  const identity = await getDeviceIdentity()
  await storage.setRelayUrl(relayUrl)
  client = new RelayClient({
    relayUrl,
    deviceId: identity.deviceId,
    name: identity.name,
    code,
  })
  client.onStatus((s) => useRelayStore.getState().setStatus(s))
  client.onAgentEvent((e) => useRelayStore.getState().handleAgentEvent(e))
  await client.start()
}

export async function reconfigureRelay(relayUrl: string): Promise<void> {
  if (!client) {
    const identity = await getDeviceIdentity()
    client = new RelayClient({ relayUrl, deviceId: identity.deviceId, name: identity.name })
    client.onStatus((s) => useRelayStore.getState().setStatus(s))
    client.onAgentEvent((e) => useRelayStore.getState().handleAgentEvent(e))
    await client.start()
  } else {
    await storage.setRelayUrl(relayUrl)
    await client.reconfigure({ relayUrl })
  }
}

export async function unbindAndReset(): Promise<void> {
  if (client) client.shutdown()
  client = null
  await storage.clearToken()
  useRelayStore.setState({
    status: { connected: false, peerOnline: false, peer: null, lastError: null },
    sessions: [],
    messages: {},
  })
}

interface RelayStoreState {
  status: RelayStatus
  sessions: SessionSummary[]
  messages: Record<string, ChatMessage[]>
  loadingSessions: boolean
  loadingMessages: Record<string, boolean>
  setStatus: (s: RelayStatus) => void
  loadSessions: () => Promise<void>
  loadMessages: (sessionId: string) => Promise<void>
  createTask: (prompt: string, model?: string) => Promise<{ sessionId: string }>
  sendMessage: (sessionId: string, message: string) => Promise<boolean>
  searchLibrary: (query: string) => Promise<LibrarySearchResult[]>
  handleAgentEvent: (e: AgentEvent) => void
}

export const useRelayStore = create<RelayStoreState>((set, get) => ({
  status: { connected: false, peerOnline: false, peer: null, lastError: null },
  sessions: [],
  messages: {},
  loadingSessions: false,
  loadingMessages: {},

  setStatus: (s) => set({ status: s }),

  loadSessions: async () => {
    const c = getRelayClient()
    if (!c || !c.status.connected) return
    set({ loadingSessions: true })
    try {
      const list = await c.call<SessionSummary[]>(SESSION_LIST)
      set({ sessions: list ?? [] })
    } finally {
      set({ loadingSessions: false })
    }
  },

  loadMessages: async (sessionId) => {
    const c = getRelayClient()
    if (!c || !c.status.connected) return
    set((s) => ({ loadingMessages: { ...s.loadingMessages, [sessionId]: true } }))
    try {
      const list = await c.call<ChatMessage[]>(SESSION_MESSAGES, { sessionId })
      set((s) => ({ messages: { ...s.messages, [sessionId]: list ?? [] } }))
    } finally {
      set((s) => {
        const next = { ...s.loadingMessages }
        delete next[sessionId]
        return { loadingMessages: next }
      })
    }
  },

  createTask: async (prompt, model) => {
    const c = getRelayClient()
    if (!c || !c.status.connected) throw new Error("未连接中继")
    return await c.call<{ sessionId: string }>(TASK_CREATE, { prompt, model })
  },

  sendMessage: async (sessionId, message) => {
    const c = getRelayClient()
    if (!c || !c.status.connected) throw new Error("未连接中继")
    const r = await c.call<{ ok: boolean }>(SESSION_SEND, { sessionId, message })
    return r?.ok ?? false
  },

  searchLibrary: async (query) => {
    const c = getRelayClient()
    if (!c || !c.status.connected) throw new Error("未连接中继")
    const r = await c.call<LibrarySearchResult[]>(LIBRARY_SEARCH, { query })
    return r ?? []
  },

  handleAgentEvent: (e) => {
    // 简化：message.assistant.delta/done 时追加到对应会话消息
    const sid = String(e.sessionId ?? "")
    if (!sid) return
    const type = String(e.type ?? "")
    if (type === "message.assistant.delta") {
      const content = String(e.content ?? "")
      set((s) => {
        const arr = [...(s.messages[sid] ?? [])]
        const last = arr[arr.length - 1]
        if (last && last.role === "assistant" && !last.done) {
          last.content += content
        } else {
          arr.push({ id: `delta-${Date.now()}`, role: "assistant", content })
        }
        return { messages: { ...s.messages, [sid]: arr } }
      })
    } else if (type === "message.assistant.done") {
      const content = String(e.content ?? "")
      set((s) => {
        const arr = [...(s.messages[sid] ?? [])]
        const last = arr[arr.length - 1]
        if (last && last.role === "assistant") {
          last.content = content
          last.done = true
        } else {
          arr.push({ id: `done-${Date.now()}`, role: "assistant", content, done: true })
        }
        return { messages: { ...s.messages, [sid]: arr } }
      })
    } else if (type === "message.user") {
      const content = String(e.content ?? "")
      set((s) => {
        const arr = [...(s.messages[sid] ?? [])]
        arr.push({ id: `u-${Date.now()}`, role: "user", content })
        return { messages: { ...s.messages, [sid]: arr } }
      })
    }
    // 会话列表：有新会话/标题更新时刷新
    if (type === "session.created" || type === "session.updated") {
      void get().loadSessions()
    }
  },
}))
