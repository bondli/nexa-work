/**
 * 连接器（Connector）类型定义 —— 对齐 docs/tech-design.md §2.3
 *
 * 每个 connector 是 ~/.nexa/connectors/<id>.yaml:
 *   config.base_url / config.headers（headers 值支持 ${secret:key} 模板）
 *   secrets（凭据，支持 enc:v1:... 加密格式或明文）
 *   endpoints（name → method + path，path 支持 :param 占位）
 */
import type { ConnectorInfo, ConnectorEndpoint, ConnectorTestResult } from "@shared/ipc-channels"

export type { ConnectorInfo, ConnectorEndpoint, ConnectorTestResult }

/** 完整连接器对象（主进程内部使用，含凭据模板） */
export interface Connector extends ConnectorInfo {
  /** 固定请求头（值可含 ${secret:key} 模板） */
  headers?: Record<string, string>
  /** 凭据键值（值可为 enc:v1:... 密文或明文） */
  secrets?: Record<string, string>
  yamlPath: string
}

/** connector_call 的调用参数 */
export interface ConnectorCallParams {
  path?: Record<string, string>
  query?: Record<string, string>
  body?: unknown
}

/** HTTP 调用结果 */
export interface ConnectorCallResult {
  ok: boolean
  status: number
  body: string
  latencyMs: number
}
