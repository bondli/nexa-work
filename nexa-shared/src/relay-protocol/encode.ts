/**
 * 中继消息编解码（纯函数，三端共用）
 */

import type { RelayEnvelope } from "../types/relay"

/** 编码消息信封为 JSON 字符串 */
export function encode(msg: RelayEnvelope): string {
  return JSON.stringify(msg)
}

/** 解码 JSON 字符串为消息信封，非法 JSON 返回 null */
export function decode(raw: string): RelayEnvelope | null {
  try {
    const msg = JSON.parse(raw)
    if (typeof msg?.type !== "string") return null
    return msg as RelayEnvelope
  } catch {
    return null
  }
}

/** 构造请求信封 */
export function buildRequest(
  type: string,
  payload?: unknown,
  extra?: { id?: string; to?: string },
): RelayEnvelope {
  return {
    type,
    timestamp: Math.floor(Date.now() / 1000),
    payload,
    ...extra,
  }
}

/** 构造响应信封（回同 type，带 id 和 to） */
export function buildResponse(
  requestType: string,
  request: RelayEnvelope,
  payload: unknown,
): RelayEnvelope {
  return {
    type: requestType,
    id: request.id,
    timestamp: Math.floor(Date.now() / 1000),
    payload,
    to: request.sender?.deviceId,
  }
}

/** 构造错误响应信封 */
export function buildErrorResponse(
  request: RelayEnvelope,
  message: string,
): RelayEnvelope {
  return {
    type: "relay:error",
    id: request.id,
    timestamp: Math.floor(Date.now() / 1000),
    payload: { message, refType: request.type },
    to: request.sender?.deviceId,
  }
}
