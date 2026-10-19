/**
 * 中继消息协议类型 —— 三端共享（桌面端 / 手机端 / 浏览器插件）
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

// ===== 系统消息类型 =====
export const RELAY_HELLO = "relay:hello" as const
export const RELAY_PAIRED = "relay:paired" as const
export const RELAY_PEER_ONLINE = "relay:peer-online" as const
export const RELAY_PEER_OFFLINE = "relay:peer-offline" as const
export const RELAY_UNBOUND = "relay:unbound" as const
export const RELAY_PING = "relay:ping" as const
export const RELAY_PONG = "relay:pong" as const
export const RELAY_ERROR = "relay:error" as const
export const RELAY_PAIRING_PENDING = "relay:pairing-pending" as const

/** 所有系统消息类型前缀 */
export const RELAY_SYSTEM_PREFIX = "relay:" as const

// ===== 业务消息类型 =====
export const TASK_CREATE = "task:create" as const
export const SESSION_SEND = "session:send" as const
export const SESSION_PAUSE = "session:pause" as const
export const SESSION_RESUME = "session:resume" as const
export const SESSION_LIST = "session:list" as const
export const SESSION_MESSAGES = "session:messages" as const
export const AGENT_EVENT = "agent:event" as const
export const SCHEDULER_NOTIFY = "scheduler:notify" as const
export const LIBRARY_INGEST_ARTICLE = "library:ingest-article" as const
export const LIBRARY_FAVORITE_IMAGE = "library:favorite-image" as const
export const LIBRARY_SEARCH = "library:search" as const

/** 所有已知业务消息类型 */
export const BUSINESS_MESSAGE_TYPES = [
  TASK_CREATE,
  SESSION_SEND,
  SESSION_PAUSE,
  SESSION_RESUME,
  SESSION_LIST,
  SESSION_MESSAGES,
  AGENT_EVENT,
  SCHEDULER_NOTIFY,
  LIBRARY_INGEST_ARTICLE,
  LIBRARY_FAVORITE_IMAGE,
  LIBRARY_SEARCH,
] as const

// ===== 系统消息 payload 类型 =====
export interface RelayHelloPayload {
  token?: string
  peer?: PairedPeer | null
}

export interface RelayPairedPayload {
  deviceId: string
  name: string
  role: RelayRole
}

export interface RelayPeerStatusPayload {
  deviceId: string
  role: RelayRole
}

export interface RelayErrorPayload {
  message: string
  refType?: string
}

// ===== 业务消息 payload 类型 =====
export interface TaskCreatePayload {
  prompt: string
  model?: string
}

export interface SessionSendPayload {
  sessionId: string
  message: string
}

export interface SessionActionPayload {
  sessionId: string
}

export interface AgentEventPayload {
  type: string
  sessionId: string
  [key: string]: unknown
}

export interface SchedulerNotifyPayload {
  success: boolean
  description: string
  output: string
  jobId?: string
}

export interface LibraryIngestArticlePayload {
  url: string
  html?: string
  title?: string
}

export interface LibraryFavoriteImagePayload {
  url: string
  data: string
  mimeType?: string
}

export interface LibrarySearchPayload {
  query: string
}

// ===== RPC 响应 payload 类型 =====
export interface TaskCreateResponse {
  sessionId: string
  title: string
  mode: string
}

export interface LibraryIngestArticleResponse {
  ok: boolean
  id?: string
  title?: string
  duplicate?: boolean
}

export interface LibraryFavoriteImageResponse {
  ok: boolean
  id?: string
}

export interface LibrarySearchResultItem {
  id: string
  title: string
  summary?: string
  type: string
}
