/**
 * 用户设置读取 (~/.nexa/settings.json)
 * v1 无设置页 UI，settings.json 是 API key 与默认模型的手动配置入口
 *
 * 格式:
 * {
 *   "apiKeys": { "deepseek": "sk-...", "anthropic": "sk-ant-..." },
 *   "defaultModel": "deepseek/deepseek-v4-flash",
 *   // 旧格式兼容
 *   "model": { "providerId": "deepseek", "modelId": "deepseek-v4-flash" }
 * }
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { getEnvApiKey, getModel, type Model } from "@earendil-works/pi-ai"

export type ThemePreference = "system" | "light" | "dark"

export interface NexaSettings {
  /** provider 名称 → API key */
  apiKeys: Record<string, string>
  /** provider 名称 → 自定义 Base URL（空/缺省 = 用 pi-ai 内置默认） */
  baseUrls: Record<string, string>
  /** provider 名称 → 是否启用（缺省时按有无 API key 推断） */
  enabledProviders: Record<string, boolean>
  /** 默认模型，格式 "provider/modelId" */
  defaultModel: string
  /** M5b 中继服务器地址（http/https 基地址，如 http://127.0.0.1:8787）；空串=不连接 */
  relayUrl: string
  /** 是否已完成初始化向导 */
  initialized: boolean
  /** 用户名（引导时设置） */
  userName: string
  /** 主题偏好 */
  theme: ThemePreference
  /** 会话内容字号（px），缺省 14 */
  chatFontSize?: 12 | 14 | 16
  /** 通知提示音名称（workbuddy 风格），缺省「灵动」；「静音」= 不播放 */
  notificationSound?: string
  /** 定时任务产物生成后是否发桌面通知，缺省 true */
  scheduledNoticeEnabled?: boolean
  /** 从项目分组列表中移除（软隐藏）的 projectPath（绝对路径，去尾斜杠），持久化 */
  hiddenProjectPaths?: string[]
}

const SETTINGS_PATH = join(homedir(), ".nexa", "settings.json")

/** 读取 settings.json，兼容 v1 旧格式（model.providerId + model.modelId）和新格式（defaultModel） */
export function loadSettings(): NexaSettings {
  const empty: NexaSettings = {
    apiKeys: {},
    baseUrls: {},
    enabledProviders: {},
    defaultModel: "",
    relayUrl: "",
    initialized: false,
    userName: "",
    theme: "dark",
    notificationSound: "灵动",
    scheduledNoticeEnabled: true,
    hiddenProjectPaths: [],
  }
  if (!existsSync(SETTINGS_PATH)) {
    return empty
  }
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as Record<string, unknown>

    // apiKeys: 旧格式可能没有这个字段，fallback 到空对象
    const apiKeys = (raw.apiKeys as Record<string, string> | undefined) ?? {}

    // defaultModel: 新格式直接读；旧格式从 model.providerId + model.modelId 拼
    let defaultModel = (raw.defaultModel as string | undefined) ?? ""
    if (!defaultModel) {
      const model = (raw.model as { providerId?: string; modelId?: string } | undefined)
      if (model?.providerId && model?.modelId) {
        defaultModel = `${model.providerId}/${model.modelId}`
      }
    }

    // relayUrl: 兼容设计稿中的 relay.serverUrl 嵌套写法
    let relayUrl = (raw.relayUrl as string | undefined) ?? ""
    if (!relayUrl) {
      const relay = raw.relay as { serverUrl?: string } | undefined
      if (relay?.serverUrl) {
        // 设计稿存的是 wss://，REST 申请配对码需要 http(s)://
        relayUrl = relay.serverUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:")
      }
    }

    return {
      apiKeys,
      baseUrls: (raw.baseUrls as Record<string, string> | undefined) ?? {},
      enabledProviders: (raw.enabledProviders as Record<string, boolean> | undefined) ?? {},
      defaultModel,
      relayUrl: relayUrl.trim(),
      initialized: (raw.initialized as boolean | undefined) ?? false,
      userName: (raw.userName as string | undefined) ?? "",
      theme: ((raw.theme as ThemePreference | undefined) ?? "dark"),
      chatFontSize: (raw.chatFontSize as 12 | 14 | 16 | undefined) ?? undefined,
      notificationSound: (raw.notificationSound as string | undefined) || "灵动",
      scheduledNoticeEnabled: (raw.scheduledNoticeEnabled as boolean | undefined) ?? true,
      hiddenProjectPaths: Array.isArray(raw.hiddenProjectPaths) ? (raw.hiddenProjectPaths as string[]) : [],
    }
  } catch {
    return empty
  }
}

/** 合并更新 settings.json（保留已有字段，只更新传入的） */
export function saveSettings(update: Partial<NexaSettings>): NexaSettings {
  const current = loadSettings()
  const next: NexaSettings = {
    apiKeys: update.apiKeys ? { ...current.apiKeys, ...update.apiKeys } : current.apiKeys,
    baseUrls: update.baseUrls ? { ...current.baseUrls, ...update.baseUrls } : current.baseUrls,
    enabledProviders: update.enabledProviders ?? current.enabledProviders,
    defaultModel: update.defaultModel ?? current.defaultModel,
    relayUrl: update.relayUrl !== undefined ? update.relayUrl : current.relayUrl,
    initialized: update.initialized ?? current.initialized,
    userName: update.userName ?? current.userName,
    theme: update.theme ?? current.theme,
    chatFontSize: update.chatFontSize ?? current.chatFontSize,
    notificationSound: update.notificationSound ?? current.notificationSound,
    // 布尔值需用 !== undefined 判断：false 是合法值，用 ?? 会丢失
    scheduledNoticeEnabled: update.scheduledNoticeEnabled !== undefined ? update.scheduledNoticeEnabled : current.scheduledNoticeEnabled,
    hiddenProjectPaths: update.hiddenProjectPaths ?? current.hiddenProjectPaths,
  }

  // 写入时同时保留旧格式兼容（同步 model.providerId/modelId）
  const raw = existsSync(SETTINGS_PATH)
    ? JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as Record<string, unknown>
    : {}

  const [providerId, modelId] = next.defaultModel.includes("/")
    ? next.defaultModel.split("/")
    : ["", ""]

  raw.apiKeys = next.apiKeys
  raw.baseUrls = next.baseUrls
  raw.enabledProviders = next.enabledProviders
  raw.defaultModel = next.defaultModel
  raw.relayUrl = next.relayUrl
  raw.initialized = next.initialized
  raw.userName = next.userName
  raw.theme = next.theme
  // chatFontSize 仅在有值时写入（undefined 不落盘）
  if (next.chatFontSize !== undefined) raw.chatFontSize = next.chatFontSize
  raw.notificationSound = next.notificationSound
  raw.scheduledNoticeEnabled = next.scheduledNoticeEnabled
  raw.hiddenProjectPaths = next.hiddenProjectPaths
  // 旧的嵌套 relay.serverUrl 已迁移为顶层 relayUrl，清掉避免歧义
  if (raw.relay && typeof raw.relay === "object") delete (raw.relay as Record<string, unknown>).serverUrl
  if (providerId && modelId) {
    raw.model = { ...(raw.model as Record<string, unknown> | undefined ?? {}), providerId, modelId }
  }

  writeFileSync(SETTINGS_PATH, JSON.stringify(raw, null, 2), "utf8")
  return next
}

/**
 * 解析模型字符串 "provider/modelId" → pi-ai Model
 * 找不到 provider 或 modelId 时返回 null
 */
export function resolveModel(modelStr: string): Model<string> | null {
  const slashIndex = modelStr.indexOf("/")
  if (slashIndex <= 0) return null
  const provider = modelStr.slice(0, slashIndex)
  const modelId = modelStr.slice(slashIndex + 1)
  try {
    // pi-ai 的 getModel 参数是字面量联合类型，运行时动态查找需要放宽
    const lookup = getModel as unknown as (p: string, m: string) => Model<string> | undefined
    const model = lookup(provider, modelId)
    if (!model) return null
    // 用户在设置页配置了自定义 Base URL 时覆盖内置默认
    const customBaseUrl = loadSettings().baseUrls[provider]?.trim()
    return customBaseUrl ? { ...model, baseUrl: customBaseUrl } : model
  } catch {
    return null
  }
}

/**
 * 获取指定 provider 的 API key
 * 显式禁用的 provider 返回 undefined；优先 settings.json，fallback 环境变量
 */
export function getApiKey(provider: string): string | undefined {
  const settings = loadSettings()
  if (settings.enabledProviders[provider] === false) return undefined
  // 用 || 而非 ??：空串视为未配置，回落环境变量
  return settings.apiKeys[provider] || getEnvApiKey(provider) || undefined
}
