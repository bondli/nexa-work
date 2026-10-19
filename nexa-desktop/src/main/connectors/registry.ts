/**
 * ConnectorManager —— 内置连接器 + 扫描 ~/.nexa/connectors/*.yaml + 统一 HTTP 调用 + health check
 * v1: 通用 http 类型连接器；鉴权经 ${secret:key} 模板注入 headers；自动重试留 v2
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parse, stringify } from "yaml"
import { decryptSecret, encryptSecret, isEncrypted } from "./crypto"
import { BUILTIN_CONNECTORS } from "./builtin"
import type { Connector, ConnectorCallParams, ConnectorCallResult, ConnectorTestResult } from "./types"
import type { ConnectorEndpoint, ConnectorDetail } from "@shared/ipc-channels"

export function connectorsDir(): string {
  return join(homedir(), ".nexa", "connectors")
}

const CALL_TIMEOUT_MS = 30_000
const MAX_BODY = 20 * 1024

export class ConnectorManager {
  constructor() {
    if (!existsSync(connectorsDir())) mkdirSync(connectorsDir(), { recursive: true })
    this.materializeBuiltins()
  }

  /** 全部连接器 = 内置 + 用户自定义 */
  list(): Connector[] {
    return [...this.listBuiltin(), ...this.listUser()]
  }

  /** 是否内置连接器（随应用提供，不可删除、不可改名） */
  isBuiltin(id: string): boolean {
    return BUILTIN_CONNECTORS.some((b) => b.id === id)
  }

  /** 内置连接器落盘：yaml 不存在时写入（已存在不覆盖，尊重用户修改） */
  private materializeBuiltins(): void {
    for (const b of BUILTIN_CONNECTORS) {
      const filePath = join(connectorsDir(), `${b.id}.yaml`)
      if (existsSync(filePath)) continue
      if (!existsSync(connectorsDir())) mkdirSync(connectorsDir(), { recursive: true })
      writeFileSync(filePath, b.yaml, "utf8")
    }
  }

  /** 内置连接器同样从磁盘读（启动时已落盘），保证行为与用户连接器一致 */
  private listBuiltin(): Connector[] {
    const out: Connector[] = []
    for (const b of BUILTIN_CONNECTORS) {
      try {
        const c = parseConnector(join(connectorsDir(), `${b.id}.yaml`), true)
        if (c) out.push(c)
      } catch {
        /* 单个连接器损坏不阻塞其他加载 */
      }
    }
    return out
  }

  /** 用户自定义连接器（排除内置 id，避免重复） */
  private listUser(): Connector[] {
    const dir = connectorsDir()
    if (!existsSync(dir)) return []
    const builtinIds = new Set(BUILTIN_CONNECTORS.map((b) => b.id))
    const out: Connector[] = []
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue
      if (builtinIds.has(file.replace(/\.ya?ml$/, ""))) continue
      try {
        const c = parseConnector(join(dir, file), false)
        if (c) out.push(c)
      } catch {
        /* 单个连接器损坏不阻塞其他加载 */
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id))
  }

  get(id: string): Connector | null {
    return this.list().find((c) => c.id === id) ?? null
  }

  /** 端点存在性校验（工具调用与 health check 共用） */
  private resolveEndpoint(c: Connector, endpointName: string): ConnectorEndpoint | null {
    return c.endpoints.find((e) => e.name === endpointName) ?? null
  }

  /**
   * 统一 HTTP 调用: path 占位替换 + ${secret:key} 解密注入 + 超时
   * 失败 throw（connector_call 工具以异常上抛，pi 判 isError）
   */
  async call(connectorId: string, endpointName: string, params: ConnectorCallParams = {}): Promise<ConnectorCallResult> {
    const c = this.get(connectorId)
    if (!c) throw new Error(`连接器 "${connectorId}" 不存在`)
    const ep = this.resolveEndpoint(c, endpointName)
    if (!ep) {
      const names = c.endpoints.map((e) => e.name).join(", ") || "（无）"
      throw new Error(`连接器 "${connectorId}" 没有端点 "${endpointName}"，可用端点: ${names}`)
    }
    // URL 组装: base_url + path（先解析 ${secret:key} 模板，再替换 :param 占位）
    let pathStr = replaceSecrets(ep.path, c)
    for (const [k, v] of Object.entries(params.path ?? {})) {
      pathStr = pathStr.replace(`:${k}`, encodeURIComponent(v))
    }
    if (/:\w+/.test(pathStr)) throw new Error(`路径参数缺失: ${pathStr}`)
    const url = new URL(c.baseUrl.replace(/\/$/, "") + (pathStr.startsWith("/") ? pathStr : "/" + pathStr))
    for (const [k, v] of Object.entries(params.query ?? {})) url.searchParams.set(k, v)
    if (!/^https?:$/.test(url.protocol)) throw new Error(`不支持的协议: ${url.protocol}`)

    // 请求头: config.headers 模板解密
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(c.headers ?? {})) {
      headers[k] = replaceSecrets(v, c)
    }
    headers["User-Agent"] = "Nexa-Desktop/0.1"
    const method = ep.method.toUpperCase()
    let body: string | undefined
    if (params.body !== undefined && method !== "GET" && method !== "HEAD") {
      body = JSON.stringify(params.body)
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json"
    }

    const startedAt = Date.now()
    let res: Response
    try {
      res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(msg.includes("timeout") || msg.includes("abort") ? `请求超时（${CALL_TIMEOUT_MS / 1000}s）` : `请求失败: ${msg}`)
    }
    let text = await res.text()
    if (text.length > MAX_BODY) text = text.slice(0, MAX_BODY) + `...(响应过长已截断，共 ${text.length} 字符)`
    return { ok: res.ok, status: res.status, body: text, latencyMs: Date.now() - startedAt }
  }

  /** 连接测试（管理页 + 健康监控）: 优先 health 端点，否则 GET base_url */
  async healthCheck(connectorId: string): Promise<ConnectorTestResult> {
    const c = this.get(connectorId)
    if (!c) return { ok: false, message: `连接器 "${connectorId}" 不存在` }
    try {
      const ep = this.resolveEndpoint(c, "health")
      const startedAt = Date.now()
      const r = ep
        ? await this.call(connectorId, "health")
        : await fetch(c.baseUrl, { method: "GET", headers: { "User-Agent": "Nexa-Desktop/0.1" }, signal: AbortSignal.timeout(10_000) }).then(async (res) => ({
            ok: res.ok,
            status: res.status,
            body: (await res.text()).slice(0, MAX_BODY),
            latencyMs: Date.now() - startedAt,
          }))
      return {
        ok: r.ok,
        status: r.status,
        latencyMs: r.latencyMs,
        message: r.ok ? `连接正常（HTTP ${r.status}，${r.latencyMs}ms）` : `HTTP ${r.status}`,
      }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 连接器详情（yaml 原文，secrets 保持密文） */
  getDetail(id: string): ConnectorDetail | null {
    const c = this.get(id)
    if (!c) return null
    return { ...c, yaml: readFileSync(c.yamlPath, "utf8") }
  }

  /**
   * 保存连接器 yaml: 解析校验 → secrets 明文自动加密 → 写回
   * id 为新文件名（编辑时传原 id 则删除旧文件，实现改名）
   */
  saveYaml(id: string, yamlText: string, previousId?: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error("连接器 name 只能包含字母、数字、下划线和连字符")
    if (previousId && this.isBuiltin(previousId) && id !== previousId) throw new Error("内置连接器不可改名")
    const doc = parse(yamlText) as Record<string, unknown> | null
    if (!doc || typeof doc !== "object") throw new Error("YAML 解析失败")
    if (typeof doc.name !== "string" || !doc.name.trim()) throw new Error("yaml 缺少 name 字段")
    const config = (doc.config ?? {}) as Record<string, unknown>
    if (typeof config.base_url !== "string" || !config.base_url) throw new Error("yaml 缺少 config.base_url 字段")
    // secrets 明文 → 加密（enc: 密文原样保留）
    const secrets = (doc.secrets ?? {}) as Record<string, string>
    const encrypted: Record<string, string> = {}
    for (const [k, v] of Object.entries(secrets)) {
      encrypted[k] = typeof v === "string" && !isEncrypted(v) ? encryptSecret(v) : v
    }
    doc.secrets = encrypted
    if (!existsSync(connectorsDir())) mkdirSync(connectorsDir(), { recursive: true })
    writeFileSync(join(connectorsDir(), `${id}.yaml`), stringify(doc), "utf8")
    // 改名场景：删除旧文件
    if (previousId && previousId !== id) {
      const oldPath = join(connectorsDir(), `${previousId}.yaml`)
      if (existsSync(oldPath)) unlinkSync(oldPath)
    }
    return id
  }

  /** 删除连接器 yaml（内置连接器禁止删除） */
  deleteYaml(id: string): boolean {
    if (this.isBuiltin(id)) throw new Error("内置连接器不可删除")
    const filePath = join(connectorsDir(), `${id}.yaml`)
    if (!existsSync(filePath)) return false
    unlinkSync(filePath)
    return true
  }
}

/** ${secret:key} 模板替换（凭据解密） */
function replaceSecrets(value: string, c: Connector): string {
  return value.replace(/\$\{secret:([\w-]+)\}/g, (_, key: string) => {
    const raw = c.secrets?.[key]
    if (raw === undefined) throw new Error(`缺少凭据 "${key}"，请在连接器 ${c.id} 的 secrets 中配置`)
    return decryptSecret(raw)
  })
}

/** 解析单个连接器 yaml */
function parseConnector(filePath: string, builtin: boolean): Connector | null {
  const doc = parse(readFileSync(filePath, "utf8")) as Record<string, unknown> | null
  if (!doc || typeof doc !== "object") return null
  const name = typeof doc.name === "string" ? doc.name.trim() : ""
  const config = (doc.config ?? {}) as Record<string, unknown>
  const baseUrl = typeof config.base_url === "string" ? config.base_url : ""
  if (!name || !baseUrl) return null
  const endpoints: ConnectorEndpoint[] = []
  const rawEps = (doc.endpoints ?? {}) as Record<string, Record<string, unknown>>
  for (const [epName, ep] of Object.entries(rawEps)) {
    if (!ep || typeof ep !== "object") continue
    endpoints.push({
      name: epName,
      method: typeof ep.method === "string" ? ep.method.toUpperCase() : "GET",
      path: typeof ep.path === "string" ? ep.path : "/",
    })
  }
  const secrets = (doc.secrets ?? {}) as Record<string, string>
  return {
    id: name,
    displayName: typeof doc.display_name === "string" ? doc.display_name : name,
    type: typeof doc.type === "string" ? doc.type : "http",
    baseUrl,
    endpoints,
    hasSecrets: Object.keys(secrets).length > 0,
    secretKeys: Object.keys(secrets),
    builtin,
    headers: (config.headers ?? undefined) as Record<string, string> | undefined,
    secrets,
    yamlPath: filePath,
  }
}
