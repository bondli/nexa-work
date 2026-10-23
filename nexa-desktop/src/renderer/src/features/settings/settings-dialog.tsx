/**
 * 设置全局弹框 —— 由 nav-rail 齿轮唤出，替代原全页模式
 * 固定高度（640px），左侧竖排分组导航 + 右侧内容区（滚动收敛于内容区，切 tab 不抖动）
 * 通用 tab 含主题 / 会话字号；模型 tab 独立承载 provider 配置（修改即保存，600ms 防抖）
 */
import { useState, useEffect, useRef } from "react"
import { Cpu, BookOpen, Brain, Trash2, Pencil, Save, Search, Smartphone, Sun, Moon, Monitor, Check, SlidersHorizontal, ArrowUpRight } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { Switch } from "@renderer/components/ui/switch"
import { Input } from "@renderer/components/ui/input"
import { Card } from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@renderer/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { useConversationStore } from "@renderer/stores/conversation-store"
import { useThemeStore } from "@renderer/stores/theme-store"
import { useSettingsOpen } from "@renderer/stores/ui-store"
import { RelayPairingTab } from "@renderer/components/relay-pairing-tab"
import { cn } from "@renderer/lib/utils"
import { playNoticeSound, NOTICE_SOUND_OPTIONS } from "@renderer/lib/notification-sound"
import type { ChatFontSize } from "@renderer/lib/theme"

/** provider 卡片定义（对齐 demo：DeepSeek 默认，OpenAI / Anthropic 对标） */
const PROVIDERS: { id: string; label: string; keyPlaceholder: string; baseUrlPlaceholder: string; gradient: string }[] = [
  { id: "deepseek", label: "DeepSeek", keyPlaceholder: "sk-...", baseUrlPlaceholder: "https://api.deepseek.com/v1", gradient: "from-blue-500 to-cyan-500" },
  { id: "openai", label: "OpenAI", keyPlaceholder: "sk-...", baseUrlPlaceholder: "https://api.openai.com/v1", gradient: "from-green-500 to-emerald-500" },
  { id: "anthropic", label: "Anthropic", keyPlaceholder: "sk-ant-...", baseUrlPlaceholder: "https://api.anthropic.com", gradient: "from-orange-500 to-red-500" },
]

interface ModelInfo {
  id: string
  displayName: string
  provider: string
  modelId: string
}

type Tab = "general" | "model" | "knowledge" | "memory" | "relay"

const TABS: { id: Tab; label: string; icon: typeof Cpu }[] = [
  { id: "general", label: "通用", icon: SlidersHorizontal },
  { id: "model", label: "模型", icon: Cpu },
  { id: "knowledge", label: "知识库", icon: BookOpen },
  { id: "memory", label: "记忆", icon: Brain },
  { id: "relay", label: "手机配对", icon: Smartphone },
]

const THEME_OPTIONS: { id: "system" | "light" | "dark"; label: string; icon: typeof Sun }[] = [
  { id: "system", label: "跟随系统", icon: Monitor },
  { id: "light", label: "亮色", icon: Sun },
  { id: "dark", label: "暗黑", icon: Moon },
]

const FONT_OPTIONS: { px: ChatFontSize; label: string }[] = [
  { px: 12, label: "小" },
  { px: 14, label: "中" },
  { px: 16, label: "大" },
]

const TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  note: { label: "金句", cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  article: { label: "文章", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  image: { label: "图片", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  doc: { label: "文档", cls: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
}

const LAYER_LABEL: Record<string, { label: string; cls: string }> = {
  profile: { label: "画像", cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  state: { label: "状态", cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  preference: { label: "偏好", cls: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
}

interface KbItem {
  id: string
  type: string
  title: string
  summary: string
  keywords: string[]
  created_at: number
}

interface MemItem {
  id: string
  layer: string
  category: string
  content: string
  confidence: number
}

export function SettingsDialog() {
  const open = useSettingsOpen((s) => s.settingsOpen)
  const setOpen = useSettingsOpen((s) => s.setSettingsOpen)
  const availableModels = useConversationStore((s) => s.availableModels)
  const currentModel = useConversationStore((s) => s.currentModel)
  const setCurrentModel = useConversationStore((s) => s.setCurrentModel)
  const initDefaultModel = useConversationStore((s) => s.initDefaultModel)
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const chatFontSize = useThemeStore((s) => s.chatFontSize)
  const setChatFontSize = useThemeStore((s) => s.setChatFontSize)

  const [tab, setTab] = useState<Tab>("general")
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [baseUrls, setBaseUrls] = useState<Record<string, string>>({})
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [selectedModel, setSelectedModel] = useState(currentModel)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 初始加载完成前禁止自动保存（避免把初始空值写回 settings.json） */
  const loadedRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 通知
  const [noticeSound, setNoticeSound] = useState<string>("灵动")
  const [scheduledNotice, setScheduledNotice] = useState(true)

  // 知识库
  const [kbItems, setKbItems] = useState<KbItem[]>([])
  const [kbSearch, setKbSearch] = useState("")

  // 记忆
  const [memItems, setMemItems] = useState<MemItem[]>([])
  const [editingMem, setEditingMem] = useState<string | null>(null)
  const [editContent, setEditContent] = useState("")

  const loadKb = async () => {
    if (typeof window === "undefined" || !window.nexa) return
    try {
      const res = (await window.nexa.kbList({ limit: 100 })) as KbItem[]
      setKbItems(res ?? [])
    } catch { /* ignore */ }
  }

  const loadMemory = async () => {
    if (typeof window === "undefined" || !window.nexa) return
    try {
      const res = (await window.nexa.memoryList({})) as MemItem[]
      setMemItems(res ?? [])
    } catch { /* ignore */ }
  }

  // 打开弹框时加载
  useEffect(() => {
    if (!open) return
    setError(null)
    loadedRef.current = false
    void (async () => {
      if (typeof window === "undefined" || !window.nexa) return
      try {
        const res = (await window.nexa.getSettings()) as {
          apiKeys?: Record<string, string>
          baseUrls?: Record<string, string>
          enabledProviders?: Record<string, boolean>
          defaultModel?: string
          notificationSound?: string
          scheduledNoticeEnabled?: boolean
        }
        setApiKeys(res?.apiKeys ?? {})
        setBaseUrls(res?.baseUrls ?? {})
        if (res?.defaultModel) setSelectedModel(res.defaultModel)
        setNoticeSound(res?.notificationSound || "灵动")
        setScheduledNotice(res?.scheduledNoticeEnabled !== false)
        // 启用态：显式保存值优先，缺省按有无 API key 推断（对齐 demo：DeepSeek 默认开）
        const derived: Record<string, boolean> = {}
        for (const p of PROVIDERS) {
          derived[p.id] = res?.enabledProviders?.[p.id] ?? Boolean(res?.apiKeys?.[p.id])
        }
        setEnabled(derived)
      } catch { /* ignore */ } finally {
        loadedRef.current = true
      }
    })()
    void loadKb()
    void loadMemory()
  }, [open])

  // 切换到知识库/记忆 tab 时刷新
  useEffect(() => {
    if (!open) return
    if (tab === "knowledge") void loadKb()
    if (tab === "memory") void loadMemory()
  }, [tab, open])

  /** 持久化模型配置（修改即保存，防抖由调用方控制） */
  const persistModelConfig = async () => {
    if (typeof window === "undefined" || !window.nexa) return
    try {
      // 三个 provider 全量写入（trim 后空串覆盖，语义=清除）
      const cleanKeys: Record<string, string> = {}
      const cleanUrls: Record<string, string> = {}
      for (const p of PROVIDERS) {
        cleanKeys[p.id] = (apiKeys[p.id] ?? "").trim()
        cleanUrls[p.id] = (baseUrls[p.id] ?? "").trim()
      }
      await window.nexa.setSettings({
        defaultModel: selectedModel,
        apiKeys: cleanKeys,
        baseUrls: cleanUrls,
        enabledProviders: { ...enabled },
      })
      setCurrentModel(selectedModel)
      await initDefaultModel()
      setError(null)
      setJustSaved(true)
      if (savedTipTimerRef.current) clearTimeout(savedTipTimerRef.current)
      savedTipTimerRef.current = setTimeout(() => setJustSaved(false), 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // 修改即保存: 模型配置任一字段变化后 600ms 防抖自动持久化
  useEffect(() => {
    if (!open || !loadedRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => void persistModelConfig(), 600)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [apiKeys, baseUrls, enabled, selectedModel, open])

  // 卸载时清理定时器
  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (savedTipTimerRef.current) clearTimeout(savedTipTimerRef.current)
    },
    []
  )

  /** 切换提示音：立即保存并试听一次（选择「静音」则不播放） */
  const changeNoticeSound = (value: string) => {
    setNoticeSound(value)
    playNoticeSound(value)
    void window.nexa.setSettings({ notificationSound: value })
  }

  /** 定时任务产物通知开关：切换即保存 */
  const changeScheduledNotice = (value: boolean) => {
    setScheduledNotice(value)
    void window.nexa.setSettings({ scheduledNoticeEnabled: value })
  }

  const handleDeleteKb = async (id: string) => {
    if (!window.nexa) return
    await window.nexa.kbDelete(id)
    setKbItems((prev) => prev.filter((i) => i.id !== id))
  }

  const startEditMem = (m: MemItem) => {
    setEditingMem(m.id)
    setEditContent(m.content)
  }

  const saveMem = async (id: string) => {
    if (!window.nexa) return
    const updated = (await window.nexa.memoryUpdate(id, { content: editContent })) as MemItem | undefined
    if (updated) {
      setMemItems((prev) => prev.map((m) => (m.id === id ? updated : m)))
    }
    setEditingMem(null)
  }

  const deleteMem = async (id: string) => {
    if (!window.nexa) return
    await window.nexa.memoryDelete(id)
    setMemItems((prev) => prev.filter((m) => (m.id !== id)))
  }

  const filteredKb = kbItems.filter((i) =>
    !kbSearch || i.title.includes(kbSearch) || i.summary.includes(kbSearch) || i.keywords.some((k) => k.includes(kbSearch))
  )

  /** 「默认」徽章挂在当前默认模型所属 provider 上（对齐 demo 的 DeepSeek 默认徽章） */
  const defaultProvider = selectedModel.split("/")[0] || "deepseek"

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[640px] max-w-[880px] gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">设置</DialogTitle>
        <DialogDescription className="sr-only">应用设置：通用、通知、模型、知识库、记忆与手机配对</DialogDescription>

        {/* 左侧分组导航（固定高度内纵向排列，不随 tab 内容变化） */}
        <nav className="flex h-full w-[200px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-sidebar p-3">
          <h2 className="mb-2 px-2.5 text-sm font-semibold">设置</h2>
          {TABS.map((t) => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            )
          })}
        </nav>

        {/* 右侧内容区（固定高度，滚动收敛在此区域） */}
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {tab === "general" && (
            <div className="mx-auto max-w-2xl">
              {/* 外观 / 主题 */}
              <section className="mb-7">
                <h3 className="mb-0.5 text-sm font-semibold">外观</h3>
                <p className="mb-3 text-xs text-muted-foreground">选择应用的配色主题，跟随系统将随 macOS 深浅色模式自动切换。</p>
                <div className="flex gap-2">
                  {THEME_OPTIONS.map((o) => {
                    const Icon = o.icon
                    const active = theme === o.id
                    return (
                      <button
                        key={o.id}
                        onClick={() => setTheme(o.id)}
                        className={cn(
                          "flex flex-1 flex-col items-center gap-1.5 rounded-lg border p-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active
                            ? "border-primary bg-primary/5 text-primary ring-1 ring-primary/30"
                            : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {o.label}
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* 会话字号（仅影响会话消息内容） */}
              <section className="mb-7">
                <h3 className="mb-0.5 text-sm font-semibold">字体大小</h3>
                <p className="mb-3 text-xs text-muted-foreground">调整会话消息内容的字号，立即生效。</p>
                <div className="flex gap-2">
                  {FONT_OPTIONS.map((o) => {
                    const active = chatFontSize === o.px
                    return (
                      <button
                        key={o.px}
                        onClick={() => setChatFontSize(o.px)}
                        className={cn(
                          "flex flex-1 flex-col items-center gap-1.5 rounded-lg border p-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active
                            ? "border-primary bg-primary/5 text-primary ring-1 ring-primary/30"
                            : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
                        )}
                      >
                        <span className="leading-none font-medium" style={{ fontSize: `${o.px}px` }}>Aa</span>
                        {o.label} · {o.px}px
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* 通知 —— 桌面系统设置入口 / 提示音 / 定时任务开关 */}
              <section className="mb-7">
                <h3 className="mb-3 text-sm font-semibold">通知</h3>
                <Card className="space-y-5 p-4 shadow-none">
                  {/* 桌面通知（系统级开关，仅提供跳转入口） */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">桌面通知</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">任务完成或有新消息时，将会通过系统弹窗提醒你。</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => void window.nexa.openNotificationSettings()}
                    >
                      前往系统设置
                      <ArrowUpRight />
                    </Button>
                  </div>

                  {/* 通知提示音 */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">通知提示音</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">收到桌面或应用内通知时播放的提示音。</p>
                    </div>
                    <Select value={noticeSound} onValueChange={changeNoticeSound}>
                      <SelectTrigger className="h-8 w-[110px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {NOTICE_SOUND_OPTIONS.map((s) => (
                          <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* 定时任务产物通知 */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">定时任务产物通知</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">定时任务的产物生成后，将会通过系统弹窗提醒你。</p>
                    </div>
                    <Switch checked={scheduledNotice} onCheckedChange={changeScheduledNotice} aria-label="定时任务产物通知" />
                  </div>
                </Card>
              </section>

            </div>
          )}

          {tab === "model" && (
            <div className="mx-auto max-w-2xl">
              {/* 模型配置 —— provider 卡片式（对齐 demo），修改即保存 */}
              <section className="mb-2">
                <div className="mb-0.5 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">模型配置</h3>
                  {/* 自动保存反馈（仅在模型 tab 内短暂展示） */}
                  {error ? (
                    <span className="text-[11px] text-red-500">{error}</span>
                  ) : justSaved ? (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-500">
                      <Check className="h-3 w-3" /> 已自动保存
                    </span>
                  ) : null}
                </div>
                <p className="mb-3 text-xs text-muted-foreground">开启 provider 并填写 API Key；选择中的「默认模型」即为会话默认使用的模型，修改后自动保存。</p>
                <div className="space-y-3">
                  {PROVIDERS.map((p) => {
                    const on = enabled[p.id] ?? false
                    const models = availableModels.filter((m: ModelInfo) => m.provider === p.id || m.id.startsWith(`${p.id}/`))
                    const currentForProvider = selectedModel.startsWith(`${p.id}/`)
                      ? selectedModel
                      : (models[0]?.id ?? "")
                    return (
                      <Card key={p.id} className={cn("p-4 shadow-none", !on && "opacity-50")}>
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={cn("h-7 w-7 rounded bg-gradient-to-br", p.gradient)} />
                            <span className="text-sm font-semibold">{p.label}</span>
                            {defaultProvider === p.id && (
                              <Badge variant="secondary" className="border-transparent bg-primary/10 font-medium text-primary">默认</Badge>
                            )}
                          </div>
                          <Switch
                            checked={on}
                            onCheckedChange={(v) => setEnabled((e) => ({ ...e, [p.id]: v }))}
                            aria-label={`${p.label} 启用`}
                          />
                        </div>
                        {on ? (
                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <label className="mb-1 block text-[11px] text-muted-foreground">API Key</label>
                              <Input
                                type="password"
                                value={apiKeys[p.id] ?? ""}
                                onChange={(e) => setApiKeys((k) => ({ ...k, [p.id]: e.target.value }))}
                                placeholder={p.keyPlaceholder}
                                className="h-8 px-2 text-xs"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] text-muted-foreground">Base URL</label>
                              <Input
                                type="text"
                                value={baseUrls[p.id] ?? ""}
                                onChange={(e) => setBaseUrls((u) => ({ ...u, [p.id]: e.target.value }))}
                                placeholder={p.baseUrlPlaceholder}
                                className="h-8 px-2 font-mono text-xs"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[11px] text-muted-foreground">默认模型</label>
                              <Select value={currentForProvider} onValueChange={setSelectedModel}>
                                <SelectTrigger className="h-8 w-full text-xs">
                                  <SelectValue placeholder={models.length === 0 ? "无可用模型" : undefined} />
                                </SelectTrigger>
                                <SelectContent>
                                  {models.length === 0 && <SelectItem value="" className="text-xs" disabled>无可用模型</SelectItem>}
                                  {models.map((m: ModelInfo) => (
                                    <SelectItem key={m.id} value={m.id} className="text-xs">{m.modelId || m.id}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground">{apiKeys[p.id] ? "已禁用" : "未配置 API Key"}</div>
                        )}
                      </Card>
                    )
                  })}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  所有密钥存储在 <code>~/.nexa/settings.json</code>，不会上传到任何服务器。Base URL 留空使用官方默认地址。
                </p>
              </section>
            </div>
          )}

          {tab === "knowledge" && (
            <div className="mx-auto max-w-xl">
              <div className="mb-3 flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  value={kbSearch}
                  onChange={(e) => setKbSearch(e.target.value)}
                  placeholder="搜索标题 / 摘要 / 关键词…"
                  className="h-8 flex-1"
                />
                <Button variant="outline" size="sm" onClick={() => void loadKb()}>刷新</Button>
              </div>
              {filteredKb.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">知识库为空。对话中可让 Agent 用 kb_add_note 等工具入库。</p>
              ) : (
                <div className="space-y-2">
                  {filteredKb.map((item) => {
                    const t = TYPE_LABEL[item.type] ?? { label: item.type, cls: "bg-muted text-muted-foreground" }
                    return (
                      <Card key={item.id} className="p-3 shadow-none">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", t.cls)}>{t.label}</span>
                              <h4 className="truncate text-sm font-medium">{item.title}</h4>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.summary}</p>
                            {item.keywords.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {item.keywords.slice(0, 5).map((k) => (
                                  <span key={k} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{k}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => void handleDeleteKb(item.id)} aria-label="删除" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-500">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "memory" && (
            <div className="mx-auto max-w-xl">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Agent 自动提取 + 用户显式写入的记忆，按层分组。</p>
                <Button variant="outline" size="sm" onClick={() => void loadMemory()}>刷新</Button>
              </div>
              {memItems.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">暂无记忆。对话中告诉 Agent「记住…」即可写入。</p>
              ) : (
                <div className="space-y-2">
                  {memItems.map((m) => {
                    const l = LAYER_LABEL[m.layer] ?? { label: m.layer, cls: "bg-muted text-muted-foreground" }
                    const isEditing = editingMem === m.id
                    return (
                      <Card key={m.id} className="p-3 shadow-none">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", l.cls)}>{l.label}</span>
                            <span className="text-xs font-medium text-foreground">{m.category}</span>
                            <span className="text-[10px] text-muted-foreground">置信度 {Math.round(m.confidence * 100)}%</span>
                          </div>
                          <div className="flex gap-1">
                            {!isEditing ? (
                              <Button variant="ghost" size="icon" onClick={() => startEditMem(m)} aria-label="编辑" className="h-6 w-6 text-muted-foreground">
                                <Pencil className="h-3 w-3" />
                              </Button>
                            ) : (
                              <Button variant="ghost" size="icon" onClick={() => saveMem(m.id)} aria-label="保存" className="h-6 w-6 text-emerald-500">
                                <Save className="h-3 w-3" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" onClick={() => deleteMem(m.id)} aria-label="删除" className="h-6 w-6 text-muted-foreground hover:text-red-500">
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        {isEditing ? (
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            rows={3}
                            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        ) : (
                          <p className="text-sm text-foreground/90">{m.content}</p>
                        )}
                      </Card>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "relay" && (
            <div className="mx-auto max-w-xl">
              <RelayPairingTab />
            </div>
          )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
