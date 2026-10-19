/**
 * 技能包管理页 —— 单列结构: 标题行 + 分区 tab 行（Skills/专家/连接器） + 列表/详情两级视图
 * Skill/连接器用 YAML 编辑，专家用结构化表单；列表卡片点击进入详情，详情头部返回列表
 */
import { useCallback, useEffect, useState } from "react"
import { Package, User, PlugZap, Plus, Save, Trash2, Loader2, CheckCircle2, XCircle, Lock, ArrowLeft } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { Switch } from "@renderer/components/ui/switch"
import { PageTitleBar } from "@renderer/components/page-layout"
import { cn } from "@renderer/lib/utils"
import { useConversationStore } from "@renderer/stores/conversation-store"
import { useSettingsOpen } from "@renderer/stores/ui-store"
import type { ConnectorInfo, ExpertDetail, SkillDetail, ConnectorDetail, ConnectorTestResult, SkillInfo, ExpertInfo } from "@shared/ipc-channels"

type Tab = "skills" | "experts" | "connectors"

const SECTION_TABS: { id: Tab; label: string; icon: typeof Package }[] = [
  { id: "skills", label: "Skills", icon: Package },
  { id: "experts", label: "专家", icon: User },
  { id: "connectors", label: "连接器", icon: PlugZap },
]

export function SkillPacksPage() {
  const [tab, setTab] = useState<Tab>("skills")
  /** true = 详情视图（列表卡片点击进入，头部返回按钮退出） */
  const [inDetail, setInDetail] = useState(false)
  // 三个分区的状态提升到页面级，切换分区时保留选中与编辑状态
  const skills = useSkillsState()
  const experts = useExpertsState()
  const connectors = useConnectorsState()

  const switchTab = (t: Tab) => {
    setTab(t)
    setInDetail(false)
  }

  const counts: Record<Tab, number> = {
    skills: skills.list.length,
    experts: experts.list.length,
    connectors: connectors.list.length,
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageTitleBar
        title="技能包"
        actions={
          /* 分区 tab 组（分段控件）：Skills / 专家 / 连接器，各带数量 */
          <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
            {SECTION_TABS.map((t) => {
              const Icon = t.icon
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => switchTab(t.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-background font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                  <span className={cn("text-[10px]", active ? "text-muted-foreground" : "text-muted-foreground/60")}>{counts[t.id]}</span>
                </button>
              )
            })}
          </div>
        }
      />

      <div className="min-h-0 flex-1">
        {tab === "skills" && (inDetail ? <SkillsDetail s={skills} onBack={() => setInDetail(false)} /> : <SkillsList s={skills} onOpen={() => setInDetail(true)} />)}
        {tab === "experts" && (inDetail ? <ExpertsDetail s={experts} onBack={() => setInDetail(false)} /> : <ExpertsList s={experts} onOpen={() => setInDetail(true)} />)}
        {tab === "connectors" && (inDetail ? <ConnectorsDetail s={connectors} onBack={() => setInDetail(false)} /> : <ConnectorsList s={connectors} onOpen={() => setInDetail(true)} />)}
      </div>
    </div>
  )
}

// ==========================================
// Skills 分区
// ==========================================
function useSkillsState() {
  const [list, setList] = useState<SkillInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [yamlText, setYamlText] = useState("")
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [isNew, setIsNew] = useState(false)

  const fetchList = useCallback(async () => {
    const l = (await window.nexa.skillList()) as NonNullable<typeof list>
    setList(l)
    return l
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    const d = (await window.nexa.skillGet(id)) as SkillDetail | null
    setDetail(d)
    setYamlText(d?.yaml ?? "")
    setFeedback(null)
  }, [])

  useEffect(() => {
    void (async () => {
      const l = await fetchList()
      if (l.length > 0) {
        setSelected(l[0].id)
        await loadDetail(l[0].id)
      }
    })()
  }, [fetchList, loadDetail])

  const handleToggle = async (id: string, enabled: boolean) => {
    await window.nexa.skillToggle({ id, enabled })
    await fetchList()
  }

  const isBuiltin = detail?.builtin ?? false

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setFeedback(null)
    try {
      // 新建: id 取 yaml 中 name 字段
      const id = isNew ? (yamlText.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/\s+/g, "-") ?? "") : selected!
      if (!id) throw new Error("无法确定 Skill id，请填写 name 字段")
      await window.nexa.skillSave({ id, yaml: yamlText })
      await fetchList()
      setSelected(id)
      await loadDetail(id)
      setIsNew(false)
      setFeedback({ ok: true, text: "已保存" })
    } catch (e) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  /** 删除用户 Skill（内置 Skill 由主进程拒绝，这里也不展示入口） */
  const handleDelete = async () => {
    if (!selected || isBuiltin) return
    setFeedback(null)
    try {
      await window.nexa.skillDelete(selected)
      setSelected(null)
      setDetail(null)
      const l = await fetchList()
      if (l.length > 0) {
        setSelected(l[0].id)
        await loadDetail(l[0].id)
      }
    } catch (e) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : String(e) })
    }
  }

  const handleNew = () => {
    setIsNew(true)
    setDetail(null)
    setYamlText(`name: my-skill\ndescription: 我的能力模块\nversion: "0.1.0"\nentry: ./index.js\ninputs:\n  - name: file_path\n    type: string\n    required: true\n    description: 输入文件路径\noutputs: []\nprompt_hint: |\n  当需要…时调用此 Skill\n`)
    setFeedback(null)
  }

  return { list, selected, setSelected, detail, yamlText, setYamlText, saving, feedback, isNew, setIsNew, isBuiltin, loadDetail, handleToggle, handleSave, handleDelete, handleNew }
}

/** Skill 列表（4 列卡片，点击进详情；Switch 独立于卡片点击） */
function SkillsList({ s, onOpen }: { s: ReturnType<typeof useSkillsState>; onOpen: () => void }) {
  const openItem = (id: string) => {
    s.setIsNew(false)
    s.setSelected(id)
    void s.loadDetail(id)
    onOpen()
  }
  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{s.list.length} 个 Skill</span>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => { s.handleNew(); onOpen() }}>
          <Plus className="h-3.5 w-3.5" /> 新建 Skill
        </Button>
      </div>
      {s.list.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
          <Package className="h-6 w-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">还没有 Skill</p>
          <p className="text-xs text-muted-foreground/70">点右上角「新建 Skill」创建第一个能力模块</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          {s.list.map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => openItem(item.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  openItem(item.id)
                }
              }}
              className="flex cursor-pointer flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Package className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={item.name}>{item.name}</span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.description || "（无描述）"}</p>
              <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                <div className="flex min-w-0 items-center gap-1.5">
                  {item.builtin && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">内置</span>}
                  {!item.enabled && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">已禁用</span>}
                </div>
                <span className="shrink-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
                  <Switch checked={item.enabled} onCheckedChange={(v) => void s.handleToggle(item.id, v)} title="启用/禁用" />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SkillsDetail({ s, onBack }: { s: ReturnType<typeof useSkillsState>; onBack: () => void }) {
  if (!s.isNew && !s.detail) {
    return <EmptyHint text="尚未选择 Skill" />
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <button
          onClick={onBack}
          aria-label="返回列表"
          title="返回列表"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="truncate text-sm font-medium">{s.isNew ? "新建 Skill" : s.detail?.name}</span>
        {s.detail && <span className="shrink-0 text-xs text-muted-foreground">v{s.detail.version}</span>}
        {s.isBuiltin && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" title="内置 Skill 随应用提供，不可删除，可在列表中停用">
            内置 · 不可删除
          </span>
        )}
        <div className="flex-1" />
        {s.feedback && (
          <span className={cn("flex items-center gap-1 text-xs", s.feedback.ok ? "text-emerald-600" : "text-destructive")}>
            {s.feedback.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {s.feedback.text}
          </span>
        )}
        {!s.isNew && !s.isBuiltin && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
            onClick={() => void s.handleDelete()}
          >
            <Trash2 className="h-3.5 w-3.5" /> 删除
          </Button>
        )}
        <Button size="sm" className="h-7 gap-1 text-xs" disabled={s.saving} onClick={() => void s.handleSave()}>
          {s.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 保存
        </Button>
      </div>
      <textarea
        value={s.yamlText}
        onChange={(e) => s.setYamlText(e.target.value)}
        spellCheck={false}
        className="min-h-0 flex-1 resize-none bg-background p-4 font-mono text-xs leading-5 outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  )
}

// ==========================================
// 专家分区
// ==========================================
function useExpertsState() {
  const [list, setList] = useState<ExpertInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<ExpertDetail | null>(null)
  const [form, setForm] = useState({ name: "", description: "", systemPrompt: "", tools: "", disallowTools: "" })
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [isNew, setIsNew] = useState(false)

  const fetchList = useCallback(async () => {
    const l = (await window.nexa.expertList()) as NonNullable<typeof list>
    setList(l)
    return l
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    const d = (await window.nexa.expertGet(id)) as ExpertDetail | null
    setDetail(d)
    if (d) {
      setForm({
        name: d.name,
        description: d.description,
        systemPrompt: d.systemPrompt,
        tools: (d.tools ?? []).join(", "),
        disallowTools: (d.disallowTools ?? []).join(", "),
      })
    }
    setFeedback(null)
  }, [])

  useEffect(() => {
    void (async () => {
      const l = await fetchList()
      if (l.length > 0) {
        setSelected(l[0].id)
        await loadDetail(l[0].id)
      }
    })()
  }, [fetchList, loadDetail])

  const isBuiltin = detail?.builtin ?? false

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setFeedback(null)
    try {
      const returnedId = (await window.nexa.expertSave({
        id: isNew ? undefined : selected!,
        name: form.name,
        description: form.description,
        systemPrompt: form.systemPrompt,
        tools: form.tools ? form.tools.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
        disallowTools: form.disallowTools ? form.disallowTools.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
      })) as string
      await fetchList()
      setSelected(returnedId)
      await loadDetail(returnedId)
      setIsNew(false)
      setFeedback({ ok: true, text: "已保存，下一轮对话生效" })
    } catch (e) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected || isBuiltin) return
    await window.nexa.expertDelete(selected)
    setSelected(null)
    setDetail(null)
    const l = await fetchList()
    if (l.length > 0) {
      setSelected(l[0].id)
      await loadDetail(l[0].id)
    }
  }

  const handleNew = () => {
    setIsNew(true)
    setDetail(null)
    setForm({ name: "", description: "", systemPrompt: "", tools: "", disallowTools: "" })
    setFeedback(null)
  }

  return { list, selected, setSelected, detail, form, setForm, saving, feedback, isNew, setIsNew, isBuiltin, loadDetail, handleSave, handleDelete, handleNew }
}

/** 专家列表（4 列卡片，点击进详情） */
function ExpertsList({ s, onOpen }: { s: ReturnType<typeof useExpertsState>; onOpen: () => void }) {
  const openItem = (id: string) => {
    s.setIsNew(false)
    s.setSelected(id)
    void s.loadDetail(id)
    onOpen()
  }
  /** 跳转到 WelcomeView，预选 expert-manager skill + 默认提示词（WorkBuddy 风格） */
  const jumpToExpertCreate = () => {
    useConversationStore.getState().setPendingExpertCreate(
      "expert-manager",
      "帮我创建一个 XXX 专家，擅长 XXXXX。\n\n我的经验是：[请补充你的行业背景、相关经验]",
    )
    useConversationStore.setState({ currentSessionId: null })
    useSettingsOpen.setState({ activeView: "chat" })
  }
  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{s.list.length} 个专家</span>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={jumpToExpertCreate}>
          <Plus className="h-3.5 w-3.5" /> 新建专家
        </Button>
      </div>
      {s.list.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
          <User className="h-6 w-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">还没有自定义专家</p>
          <p className="text-xs text-muted-foreground/70">点右上角「新建专家」在对话中创建</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          {s.list.map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => openItem(item.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  openItem(item.id)
                }
              }}
              className="flex cursor-pointer flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <User className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={item.name}>{item.name}</span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.description || "（无描述）"}</p>
              {item.builtin && (
                <div className="mt-auto flex items-center gap-1.5 pt-3">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">内置</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ExpertsDetail({ s, onBack }: { s: ReturnType<typeof useExpertsState>; onBack: () => void }) {
  if (!s.isNew && !s.detail) {
    return <EmptyHint text="尚未选择专家" />
  }
  const isBuiltin = s.isBuiltin
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <button
          onClick={onBack}
          aria-label="返回列表"
          title="返回列表"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="truncate text-sm font-medium">{s.isNew ? "新建专家" : s.detail?.name}</span>
        <div className="flex-1" />
        {s.feedback && (
          <span className={cn("flex items-center gap-1 text-xs", s.feedback.ok ? "text-emerald-600" : "text-destructive")}>
            {s.feedback.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {s.feedback.text}
          </span>
        )}
        {!s.isNew && !isBuiltin && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-destructive hover:text-destructive" onClick={() => void s.handleDelete()}>
            <Trash2 className="h-3.5 w-3.5" /> 删除
          </Button>
        )}
        <Button size="sm" className="h-7 gap-1 text-xs" disabled={s.saving || isBuiltin} onClick={() => void s.handleSave()} title={isBuiltin ? "内置专家不可修改" : undefined}>
          {s.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 保存
        </Button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <Field label="名称">
          <input
            value={s.form.name}
            onChange={(e) => s.setForm({ ...s.form, name: e.target.value })}
            disabled={isBuiltin}
            className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
        </Field>
        <Field label="描述">
          <input
            value={s.form.description}
            onChange={(e) => s.setForm({ ...s.form, description: e.target.value })}
            disabled={isBuiltin}
            className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
        </Field>
        <Field label="System Prompt（人设 + 方法论）">
          <textarea
            value={s.form.systemPrompt}
            onChange={(e) => s.setForm({ ...s.form, systemPrompt: e.target.value })}
            disabled={isBuiltin}
            spellCheck={false}
            className="min-h-[200px] w-full resize-y rounded-md border border-border bg-background p-2.5 font-mono text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="工具白名单（逗号分隔，留空 = 全部可用）">
            <input
              value={s.form.tools}
              onChange={(e) => s.setForm({ ...s.form, tools: e.target.value })}
              disabled={isBuiltin}
              placeholder="read, write, bash"
              className="h-8 w-full rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            />
          </Field>
          <Field label="禁用工具（逗号分隔）">
            <input
              value={s.form.disallowTools}
              onChange={(e) => s.setForm({ ...s.form, disallowTools: e.target.value })}
              disabled={isBuiltin}
              placeholder="edit"
              className="h-8 w-full rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            />
          </Field>
        </div>
        {isBuiltin && <p className="text-xs text-muted-foreground">内置专家只读，可新建自定义专家。</p>}
      </div>
    </div>
  )
}

// ==========================================
// 连接器分区
// ==========================================
function useConnectorsState() {
  const [list, setList] = useState<ConnectorInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<ConnectorDetail | null>(null)
  const [yamlText, setYamlText] = useState("")
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectorTestResult | null>(null)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [isNew, setIsNew] = useState(false)

  const fetchList = useCallback(async () => {
    const l = (await window.nexa.connectorList()) as ConnectorInfo[]
    setList(l)
    return l
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    const d = (await window.nexa.connectorGet(id)) as ConnectorDetail | null
    setDetail(d)
    setYamlText(d?.yaml ?? "")
    setTestResult(null)
    setFeedback(null)
  }, [])

  useEffect(() => {
    void (async () => {
      const l = await fetchList()
      if (l.length > 0) {
        setSelected(l[0].id)
        await loadDetail(l[0].id)
      }
    })()
  }, [fetchList, loadDetail])

  const handleTest = async () => {
    if (!selected || testing) return
    setTesting(true)
    setTestResult(null)
    try {
      const r = (await window.nexa.connectorTest(selected)) as ConnectorTestResult
      setTestResult(r)
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setFeedback(null)
    try {
      const id = (yamlText.match(/^name:\s*(.+)$/m)?.[1] ?? "").trim()
      if (!id) throw new Error("无法确定连接器 name，请填写 name 字段")
      await window.nexa.connectorSave({ id, yaml: yamlText, previousId: isNew ? undefined : selected! })
      await fetchList()
      setSelected(id)
      await loadDetail(id)
      setIsNew(false)
      setFeedback({ ok: true, text: "已保存（secrets 明文已自动加密）" })
    } catch (e) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected || detail?.builtin) return
    await window.nexa.connectorDelete(selected)
    setSelected(null)
    setDetail(null)
    const l = await fetchList()
    if (l.length > 0) {
      setSelected(l[0].id)
      await loadDetail(l[0].id)
    }
  }

  const handleNew = () => {
    setIsNew(true)
    setDetail(null)
    setYamlText(`name: my-connector
display_name: 我的服务
type: http
config:
  base_url: "https://api.example.com"
  headers:
    Authorization: "Bearer \${secret:token}"
secrets:
  token: "在此粘贴凭据明文（保存时自动加密）"
endpoints:
  health:
    method: GET
    path: "/"
`)
    setFeedback(null)
    setTestResult(null)
  }

  return { list, selected, setSelected, detail, yamlText, setYamlText, saving, testing, testResult, feedback, isNew, setIsNew, loadDetail, handleTest, handleSave, handleDelete, handleNew }
}

/** 连接器列表（4 列卡片，点击进详情） */
function ConnectorsList({ s, onOpen }: { s: ReturnType<typeof useConnectorsState>; onOpen: () => void }) {
  const openItem = (id: string) => {
    s.setIsNew(false)
    s.setSelected(id)
    void s.loadDetail(id)
    onOpen()
  }
  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{s.list.length} 个连接器</span>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => { s.handleNew(); onOpen() }}>
          <Plus className="h-3.5 w-3.5" /> 新建连接器
        </Button>
      </div>
      {s.list.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
          <PlugZap className="h-6 w-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">还没有连接器</p>
          <p className="text-xs text-muted-foreground/70">点右上角「新建连接器」接入外部系统</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          {s.list.map((c) => (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => openItem(c.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  openItem(c.id)
                }
              }}
              className="flex cursor-pointer flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <PlugZap className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={c.displayName}>{c.displayName}</span>
                {c.hasSecrets && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
              </div>
              <p className="mt-2 line-clamp-2 break-all text-xs leading-relaxed text-muted-foreground">{c.baseUrl || "（未配置 base_url）"}</p>
              <div className="mt-auto flex items-center gap-1.5 pt-3">
                {c.builtin && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">内置</span>}
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{c.endpoints.length} 个端点</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ConnectorsDetail({ s, onBack }: { s: ReturnType<typeof useConnectorsState>; onBack: () => void }) {
  if (!s.isNew && !s.detail) {
    return <EmptyHint text="尚未选择连接器" />
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <button
          onClick={onBack}
          aria-label="返回列表"
          title="返回列表"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="truncate text-sm font-medium">{s.isNew ? "新建连接器" : s.detail?.displayName}</span>
        {s.detail?.builtin && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" title="内置连接器随应用提供，不可删除，可编辑凭据">
            内置 · 不可删除
          </span>
        )}
        <div className="flex-1" />
        {s.feedback && (
          <span className={cn("flex items-center gap-1 text-xs", s.feedback.ok ? "text-emerald-600" : "text-destructive")}>
            {s.feedback.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {s.feedback.text}
          </span>
        )}
        {s.testResult && (
          <span className={cn("flex items-center gap-1 text-xs", s.testResult.ok ? "text-emerald-600" : "text-destructive")}>
            {s.testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {s.testResult.message}
          </span>
        )}
        {!s.isNew && (
          <>
            {!s.detail?.builtin && (
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-destructive hover:text-destructive" onClick={() => void s.handleDelete()}>
                <Trash2 className="h-3.5 w-3.5" /> 删除
              </Button>
            )}
            <Button variant="secondary" size="sm" className="h-7 gap-1 text-xs" disabled={s.testing} onClick={() => void s.handleTest()}>
              {s.testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />} 测试连接
            </Button>
          </>
        )}
        <Button size="sm" className="h-7 gap-1 text-xs" disabled={s.saving} onClick={() => void s.handleSave()}>
          {s.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} 保存
        </Button>
      </div>
      <textarea
        value={s.yamlText}
        onChange={(e) => s.setYamlText(e.target.value)}
        spellCheck={false}
        className="min-h-0 flex-1 resize-none bg-background p-4 font-mono text-xs leading-5 outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  )
}

// ==========================================
// 通用小组件
// ==========================================
function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{text}</div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}
