/**
 * 三端共享常量
 */

/** 配对码字母表（去 0/O/1/I 防混淆） */
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

/** 配对码长度 */
export const PAIRING_CODE_LENGTH = 6

/** 配对码有效期（毫秒） */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000

/** 配对码 IP 限流（次/分） */
export const PAIRING_RATE_LIMIT_PER_MIN = 30

/** 心跳间隔（毫秒） */
export const HEARTBEAT_PING_INTERVAL_MS = 25_000

/** 心跳 pong 超时（毫秒） */
export const HEARTBEAT_PONG_TIMEOUT_MS = 10_000

/** 中继 WS 路径 */
export const RELAY_WS_PATH = "/ws"

/** 重连退避序列（毫秒） */
export const RECONNECT_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000] as const

/** 默认模型列表 */
export const DEFAULT_MODELS = [
  { id: "openai/gpt-4o", displayName: "GPT-4o", provider: "openai", modelId: "gpt-4o" },
  { id: "openai/gpt-4o-mini", displayName: "GPT-4o mini", provider: "openai", modelId: "gpt-4o-mini" },
  { id: "anthropic/claude-3-5-sonnet", displayName: "Claude 3.5 Sonnet", provider: "anthropic", modelId: "claude-3-5-sonnet" },
  { id: "anthropic/claude-3-5-haiku", displayName: "Claude 3.5 Haiku", provider: "anthropic", modelId: "claude-3-5-haiku" },
  { id: "deepseek/deepseek-chat", displayName: "DeepSeek Chat", provider: "deepseek", modelId: "deepseek-chat" },
] as const

/** 默认中继端口 */
export const DEFAULT_RELAY_PORT = 8787

/** Nexa 本地数据目录 */
export const NEXA_HOME_DIR = ".nexa"

/** 知识库子目录 */
export const LIBRARY_DIR = "library"

/** 预设笔记分类 */
export const PRESET_NOTE_CATEGORIES = [
  { name: "会议", icon: "📁" },
  { name: "学习", icon: "📁" },
  { name: "工作", icon: "📁" },
  { name: "灵感", icon: "📁" },
  { name: "未分类", icon: "📁" },
] as const
