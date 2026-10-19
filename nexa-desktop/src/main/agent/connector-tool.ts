/**
 * connector_call 工具 —— Agent 调用外部系统连接器的统一入口
 * 可用连接器列表由 runtime 注入 system prompt，Agent 按需调用
 */
import { Type } from "@earendil-works/pi-ai"
import type { AgentTool } from "@earendil-works/pi-agent-core"
import type { ConnectorManager } from "../connectors/registry"

const connectorCallParams = Type.Object({
  connector: Type.String({ description: "连接器名称（见系统提示中的可用连接器列表）" }),
  endpoint: Type.String({ description: "端点名（见连接器的 endpoints 定义）" }),
  params: Type.Optional(
    Type.Object({
      path: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "路径参数（替换端点 path 中的 :param 占位）" })),
      query: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "URL 查询参数" })),
      body: Type.Optional(Type.Unknown({ description: "请求体（POST/PUT/PATCH 时使用，JSON 序列化后发送）" })),
    })
  ),
})

export function createConnectorCallTool(connectors: ConnectorManager): AgentTool<typeof connectorCallParams> {
  return {
    name: "connector_call",
    label: "调用连接器",
    description: "通过连接器调用外部系统的 API（带凭据鉴权）。调用前请确认 endpoint 与 params 符合连接器定义。",
    parameters: connectorCallParams,
    execute: async (_id, params) => {
      // 失败必须 throw（pi 只把抛出的异常判为 isError）
      const result = await connectors.call(params.connector, params.endpoint, params.params ?? {})
      return {
        content: [
          {
            type: "text",
            text: `HTTP ${result.status}（${result.latencyMs}ms）\n${result.body}`,
          },
        ],
        details: result,
      }
    },
  }
}
