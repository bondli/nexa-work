/**
 * 内置连接器 —— 随应用打包，开箱即用
 * 启动时若 ~/.nexa/connectors/<id>.yaml 不存在则落盘（已存在不覆盖，尊重用户修改）
 */

/**
 * 内置连接器: feishu —— 飞书群自定义机器人（webhook 发消息）
 * webhook 无需换取 tenant_access_token；hook_token 经 ${secret:hook_token} 注入端点路径。
 */
export const FEISHU_CONNECTOR_ID = "feishu"

export const FEISHU_CONNECTOR_YAML = `name: feishu
display_name: 飞书
type: http
config:
  base_url: "https://open.feishu.cn"
  headers:
    Content-Type: "application/json"
secrets:
  hook_token: "飞书群 → 设置 → 群机器人 → 添加自定义机器人 后获得的 webhook token"
endpoints:
  send_message:
    method: POST
    path: "/open-apis/bot/v2/hook/\${secret:hook_token}"
`

/**
 * 内置连接器清单：id → yaml 原文
 *
 * 内置连接器随应用提供、不可删除（ConnectorManager.deleteYaml 会拒绝），可编辑补全凭据。
 * 新增内置连接器：在此追加一项；启动时 ConnectorManager.materializeBuiltins 会把不存在的 yaml 落盘（已存在不覆盖）。
 */
export const BUILTIN_CONNECTORS: { id: string; yaml: string }[] = [
  { id: FEISHU_CONNECTOR_ID, yaml: FEISHU_CONNECTOR_YAML },
]
