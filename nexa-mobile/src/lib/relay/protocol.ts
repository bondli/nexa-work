/**
 * 中继消息协议类型 —— 与桌面端 / nexa-relay 保持一致
 */

export type RelayRole = "desktop" | "phone"

export interface RelaySender {
  deviceId: string
  name: string
  role: RelayRole
}

/** 通用消息信封 */
export interface RelayEnvelope<P = unknown> {
  type: string
  id?: string
  timestamp?: number
  to?: string
  payload?: P
  sender?: RelaySender
}

/** 桌面端已配对设备 */
export interface PairedPeer {
  deviceId: string
  name: string
  role: RelayRole
}

/** 会话摘要（来自 session:list 回包，字段对齐桌面 IPC SESSION_LIST） */
export interface SessionSummary {
  id: string
  title: string
  mode: "free" | "project"
  projectPath?: string | null
  status?: string
  createdAt?: number
  updatedAt?: number
  expertId?: string | null
  model?: string
  unread?: boolean
}

/** 消息条目（session:messages 回包） */
export interface ChatMessage {
  id: string
  role: "system" | "user" | "assistant" | "tool"
  content: string
  createdAt?: number
  toolName?: string
  isError?: boolean
  /** 流式增量标记：assistant done 后置 true */
  done?: boolean
}

/** Agent 事件（透传自桌面端 pi-agent-core，结构对齐 ipc-channels AgentEvent） */
export interface AgentEvent {
  type: string
  sessionId: string
  [key: string]: unknown
}

// ===== 系统消息类型 =====
export const RELAY_HELLO = "relay:hello"
export const RELAY_PAIRED = "relay:paired"
export const RELAY_PEER_ONLINE = "relay:peer-online"
export const RELAY_PEER_OFFLINE = "relay:peer-offline"
export const RELAY_UNBOUND = "relay:unbound"
export const RELAY_PING = "relay:ping"
export const RELAY_PONG = "relay:pong"
export const RELAY_ERROR = "relay:error"

// ===== 业务消息类型 =====
export const TASK_CREATE = "task:create"
export const SESSION_SEND = "session:send"
export const SESSION_PAUSE = "session:pause"
export const SESSION_RESUME = "session:resume"
export const SESSION_LIST = "session:list"
export const SESSION_MESSAGES = "session:messages"
export const AGENT_EVENT = "agent:event"
export const SCHEDULER_NOTIFY = "scheduler:notify"
export const LIBRARY_SEARCH = "library:search"

/** 资料库搜索结果条目 */
export interface LibrarySearchResult {
  id: string
  title: string
  summary?: string
  type: string
}
