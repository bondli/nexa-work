/**
 * 输入框（从 chat-shell 迁入，保持行为不变）：
 * 上部 textarea 自适应高度；下部工具行 —— 左下角 + 菜单（选技能/专家）+ 已选 chips，右下角发送按钮。
 */
import { useCallback, useEffect, useState } from "react"
import { Plus, X, Wrench, UserRound, Cpu, ChevronDown, ArrowUp } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@renderer/components/ui/dropdown-menu"
import { cn } from "@renderer/lib/utils"
import { formatModelName } from "../lib/format"
import { useExpertsStore } from "@renderer/stores/experts-store"
import { useConversationStore } from "@renderer/stores/conversation-store"
import type { AttachmentInput, SkillInfo } from "@shared/ipc-channels"

/** 暂存的图片附件（本地预览 + 待提交给主进程的 dataURL） */
interface StagedAttachment {
  id: string
  name: string
  mimeType: string
  size: number
  dataUrl: string
}

/** 单条消息最多携带的图片数 / 单张上限 */
const MAX_ATTACHMENTS = 4
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export function InputBar({
  value,
  onChange,
  onSend,
  loading,
  placeholder,
  currentExpertId,
  model,
  sessionId,
  defaultSkillId,
}: {
  value: string
  onChange: (v: string) => void
  /** text: 组装后的最终文本（技能已附加使用指令）; opts: 本次发送选定的专家 + 图片附件; 返回 false 表示发送失败（保留附件） */
  onSend: (text: string, opts: { expertId?: string; attachments?: AttachmentInput[] }) => Promise<boolean>
  loading?: boolean
  placeholder?: string
  /** 会话当前专家（Topbar 已选中的），菜单里标记 */
  currentExpertId?: string | null
  /** 会话当前模型（会话页传 conv.model，优先于全局默认） */
  model?: string | null
  /** 传入时：模型下拉切换调 sessionSetModel（下轮生效）；不传（欢迎页）：仅更新默认模型 */
  sessionId?: string
  /** 进入 WelcomeView 时预选的 skill（从技能包页点「新建专家」注入） */
  defaultSkillId?: string | null
}) {
  const experts = useExpertsStore((s) => s.experts)
  const availableModels = useConversationStore((s) => s.availableModels)
  // 只展示实际可用的模型（provider 已启用且有 API key），避免选中未配置的模型发送失败
  const usableProviders = useConversationStore((s) => s.usableProviders)
  const selectableModels = availableModels.filter((m) => usableProviders.includes(m.provider))
  const storeModel = useConversationStore((s) => s.currentModel)
  const setCurrentModel = useConversationStore((s) => s.setCurrentModel)
  const effectiveModel = model ?? storeModel
  const [menuOpen, setMenuOpen] = useState(false)
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null)
  const [selectedExpertId, setSelectedExpertId] = useState<string>("none")
  /** 捕获 defaultSkillId（WelcomeView 的 pending 消费后会清 store，这里保留住让后续 effect 继续生效） */
  const [capturedSkillId] = useState<string | null>(defaultSkillId ?? null)
  /** 待发送的图片附件（粘贴 / 拖拽） */
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  const [dragActive, setDragActive] = useState(false)

  // 菜单打开时拉取启用的技能（同时支持 defaultSkillId → mount 时就自动选中）
  useEffect(() => {
    if (!menuOpen && !capturedSkillId) return
    void window.nexa
      .skillList()
      .then((l: unknown) => setSkills(((l ?? []) as SkillInfo[]).filter((s) => s.enabled)))
      .catch(() => {})
  }, [menuOpen, capturedSkillId])

  // capturedSkillId 到位后自动选中（chip 立即可见）
  useEffect(() => {
    if (!capturedSkillId) return
    const found = skills.find((s) => s.id === capturedSkillId)
    if (found) setSelectedSkill(found)
  }, [capturedSkillId, skills])

  /**
   * 暂存图片文件（粘贴 / 拖拽统一入口）：非图片、超过 10MB 的直接忽略，
   * 总数上限 MAX_ATTACHMENTS；FileReader 转 dataURL 供预览与提交
   */
  const stageFiles = useCallback(
    (files: File[]) => {
      if (loading) return
      const images = files.filter((f) => f.type.startsWith("image/") && f.size <= MAX_IMAGE_BYTES)
      if (images.length === 0) return
      void Promise.all(
        images.slice(0, MAX_ATTACHMENTS).map(
          (f) =>
            new Promise<StagedAttachment | null>((resolve) => {
              const reader = new FileReader()
              reader.onload = () =>
                resolve({
                  id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  name: f.name || "粘贴的图片.png",
                  mimeType: f.type,
                  size: f.size,
                  dataUrl: String(reader.result),
                })
              reader.onerror = () => resolve(null)
              reader.readAsDataURL(f)
            })
        )
      ).then((list) => {
        const staged = list.filter((a): a is StagedAttachment => a !== null)
        if (staged.length > 0) setAttachments((prev) => [...prev, ...staged].slice(0, MAX_ATTACHMENTS))
      })
    },
    [loading]
  )

  /** 当前模型是否支持图片理解（不支持时给出发送前提示） */
  const modelSupportsImage = availableModels.find((m) => m.id === effectiveModel)?.supportsImage ?? false

  const canSend = (Boolean(value.trim()) || attachments.length > 0) && !loading

  const doSend = async () => {
    if (!canSend) return
    const finalText = selectedSkill
      ? `请使用技能「${selectedSkill.name}」（skill_run 工具，id: ${selectedSkill.id}）处理以下任务：\n${value.trim()}`
      : value.trim()
    const outgoing = attachments.map((a) => ({ name: a.name, mimeType: a.mimeType, dataUrl: a.dataUrl }))
    const ok = await onSend(finalText, {
      expertId: selectedExpertId !== "none" ? selectedExpertId : undefined,
      attachments: outgoing.length > 0 ? outgoing : undefined,
    })
    // 发送失败（如首条消息创建会话异常）时保留附件，避免用户重新粘贴
    if (ok !== false) setAttachments([])
  }

  const textareaRef = (el: HTMLTextAreaElement | null) => {
    if (el) {
      el.style.height = "auto"
      el.style.height = Math.min(el.scrollHeight, 160) + "px"
    }
  }

  return (
    <div
      className={cn(
        "relative rounded-2xl border bg-card shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-ring",
        dragActive ? "border-primary ring-2 ring-primary/30" : "border-input"
      )}
      onDragOver={(e) => {
        e.preventDefault()
        if (!loading) setDragActive(true)
      }}
      onDragLeave={(e) => {
        // 进入子元素时也会触发 dragleave，用 relatedTarget 判断是否真的离开了容器（避免浮层闪烁）
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragActive(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragActive(false)
        stageFiles(Array.from(e.dataTransfer.files))
      }}
    >
      {/* 附件预览（粘贴 / 拖拽的图片） */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {attachments.map((a) => (
            <div key={a.id} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-border">
              <img src={a.dataUrl} alt={a.name} title={a.name} className="h-full w-full object-cover" />
              <button
                type="button"
                aria-label="移除附件"
                title="移除附件"
                onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background/90 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 当前模型无视觉能力时的发送前提示（仍可发送：图片已落盘，工具类操作不受影响） */}
      {attachments.length > 0 && !modelSupportsImage && (
        <p className="px-3.5 pt-2 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
          当前模型不支持图片理解，Agent 看不到图片内容。如需「按图片修改页面」这类任务，请在上方切换到 GPT-4o / Claude 3.5 Sonnet。
        </p>
      )}

      {/* 文本区（支持粘贴图片） */}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData?.files ?? [])
          if (files.some((f) => f.type.startsWith("image/"))) stageFiles(files)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            void doSend()
          }
        }}
        placeholder={placeholder ?? "描述你的任务…（可粘贴或拖拽图片，Shift+Enter 换行）"}
        disabled={loading}
        rows={2}
        className="max-h-40 w-full resize-none bg-transparent px-3.5 pt-3 text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-50"
        ref={textareaRef}
      />

      {/* 工具行 */}
      <div className="flex items-center gap-1.5 px-2 pb-2 pt-0.5">
        {/* + 菜单: 技能 / 专家 */}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              title="附加技能或专家"
              aria-label="附加技能或专家"
            >
              <Plus className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-60">
            {/* 技能组 */}
            <DropdownMenuLabel className="text-xs">技能</DropdownMenuLabel>
            {skills.length === 0 ? (
              <DropdownMenuItem disabled className="text-xs">暂无启用的技能</DropdownMenuItem>
            ) : (
              <DropdownMenuRadioGroup
                value={selectedSkill?.id ?? "none"}
                onValueChange={(v) => setSelectedSkill(v === "none" ? null : skills.find((s) => s.id === v) ?? null)}
              >
                <DropdownMenuRadioItem value="none" className="text-xs">不使用技能</DropdownMenuRadioItem>
                {skills.map((s) => (
                  <DropdownMenuRadioItem key={s.id} value={s.id} className="text-xs">
                    <span className="truncate">{s.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            )}
            <DropdownMenuSeparator />
            {/* 专家组 */}
            <DropdownMenuLabel className="text-xs">专家</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={selectedExpertId || currentExpertId || "none"}
              onValueChange={setSelectedExpertId}
            >
              <DropdownMenuRadioItem value="none" className="text-xs">不使用专家</DropdownMenuRadioItem>
              {experts.map((e) => (
                <DropdownMenuRadioItem key={e.id} value={e.id} className="text-xs">
                  <span className="truncate">{e.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 已选 chips —— 点击可取消 */}
        {selectedSkill && (
          <button
            type="button"
            onClick={() => setSelectedSkill(null)}
            title="点击取消选择"
            className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md bg-primary/10 px-2 text-xs text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Wrench className="h-3 w-3" />
            <span className="max-w-[140px] truncate">{selectedSkill.name}</span>
          </button>
        )}
        {selectedExpertId && selectedExpertId !== "none" && (
          <button
            type="button"
            onClick={() => setSelectedExpertId("none")}
            title="点击取消选择"
            className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md bg-muted px-2 text-xs text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <UserRound className="h-3 w-3" />
            <span className="max-w-[140px] truncate">
              {experts.find((e) => e.id === selectedExpertId)?.name ?? selectedExpertId}
            </span>
          </button>
        )}

        <div className="flex-1" />
        {/* 模型选择（发送按钮前） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              title="切换模型（下一轮生效）"
              aria-label="切换模型"
            >
              <Cpu className="h-3.5 w-3.5" />
              <span className="max-w-[140px] truncate font-medium">
                {availableModels.find((m) => m.id === effectiveModel)?.displayName ?? formatModelName(effectiveModel)}
              </span>
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuRadioGroup
              value={effectiveModel ?? "none"}
              onValueChange={(v) => {
                setCurrentModel(v)
                if (sessionId) void window.nexa.sessionSetModel({ sessionId, model: v })
              }}
            >
              {(selectableModels.length > 0
                ? selectableModels.map((m) => ({ id: m.id, label: m.displayName }))
                : [{ id: effectiveModel ?? "none", label: formatModelName(effectiveModel ?? "") }]
              ).map((m) => (
                <DropdownMenuRadioItem key={m.id} value={m.id}>
                  <span className="truncate">{m.label}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* 发送按钮（圆形 + 向上箭头） */}
        <Button
          variant="default"
          onClick={() => void doSend()}
          disabled={!canSend}
          className="h-8 w-8 shrink-0 rounded-full"
          aria-label="发送"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      </div>

      {/* 拖拽浮层：覆盖整块输入区提示可松手 */}
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/85 text-xs font-medium text-primary">
          松开以添加图片
        </div>
      )}
    </div>
  )
}
