/**
 * 中继消息校验（纯函数）
 */

import {
  RELAY_SYSTEM_PREFIX,
  BUSINESS_MESSAGE_TYPES,
} from "../types/relay"
import type { RelayEnvelope } from "../types/relay"

/** 判断是否为系统消息（relay: 前缀） */
export function isSystemMessage(type: string): boolean {
  return type.startsWith(RELAY_SYSTEM_PREFIX)
}

/** 判断是否为已知的业务消息类型 */
export function isBusinessMessage(type: string): boolean {
  return (BUSINESS_MESSAGE_TYPES as readonly string[]).includes(type)
}

/** 校验消息信封基本结构 */
export function isValidEnvelope(msg: unknown): msg is RelayEnvelope {
  if (typeof msg !== "object" || msg === null) return false
  const m = msg as Record<string, unknown>
  return typeof m.type === "string"
}

/** 校验 sender 字段 */
export function isValidSender(sender: unknown): boolean {
  if (typeof sender !== "object" || sender === null) return false
  const s = sender as Record<string, unknown>
  return typeof s.deviceId === "string" && typeof s.name === "string" && typeof s.role === "string"
}
