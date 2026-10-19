import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { Bot, Terminal, Pause, Play, ChevronDown, ChevronRight, Cpu, Loader2, Sparkles, Copy, Check, RotateCcw, UserRound, FolderOpen, Plus, Wrench, ArrowUp, Archive, CheckCircle2, XCircle, X } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { Card } from "@renderer/components/ui/card"
import {
  ConversationContent,
  Message,
  MessageAvatar,
  MessageContent,
  Response,
  StreamingPreview,
  Thinking,
  Tool,
  PlanCard,
} from "@renderer/components/ai-elements/conversation"
import { ArtifactCards } from "@renderer/features/chat/artifact-cards"
import { LogoIcon } from "@renderer/components/logo-icon"
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
import { cn, formatMessageTime } from "@renderer/lib/utils"
import { useConversationStore, type ChatMessage, type Conversation, type AgentRunInfo } from "@renderer/stores/conversation-store"
import { useExpertsStore } from "@renderer/stores/experts-store"
import { useArtifactsStore } from "@renderer/stores/artifacts-store"
import { countWorkspaceFiles } from "@renderer/features/artifacts-panel/artifacts-panel"
import type { AttachmentInput, ChatAttachment, SkillInfo } from "@shared/ipc-channels"

export function ChatShell() {
  const currentSessionId = useConversationStore((s) => s.currentSessionId)
  const sessions = useConversationStore((s) => s.sessions)
  const conv = currentSessionId ? sessions[currentSessionId] : null

  return conv ? <ConversationView conv={conv} /> : <WelcomeView />
}

// ==========================================
// Welcome 视图 —— 无会话时显示
// ==========================================
function WelcomeView() {
  const createSession = useConversationStore((s) => s.createSession)
  const currentModel = useConversationStore((s) => s.currentModel)
  const currentExpertId = useExpertsStore((s) => s.currentExpertId)
  const pendingProjectPath = useConversationStore((s) => s.pendingProjectPath)
  const setPendingProjectPath = useConversationStore((s) => s.setPendingProjectPath)
  const pendingSkillId = useConversationStore((s) => s.pendingSkillId)
  const pendingPrompt = useConversationStore((s) => s.pendingPrompt)
  const setPendingExpertCreate = useConversationStore((s) => s.setPendingExpertCreate)
  const [text, setText] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedMode, setSelectedMode] = useState<"free" | "project">("free")
  const [projectPath, setProjectPath] = useState<string | null>(null)

  // 从侧边栏项目分组菜单点「新建任务」注入的路径 → 自动切到项目编码模式 + 预填目录
  useEffect(() => {
    if (pendingProjectPath) {
      setSelectedMode("project")
      setProjectPath(pendingProjectPath)
      setPendingProjectPath(null)
    }
  }, [pendingProjectPath, setPendingProjectPath])

  // 从技能包专家页点「新建专家」注入的 skill + prompt → 预填输入框
  useEffect(() => {
    if (pendingPrompt) {
      setText(pendingPrompt)
      setPendingExpertCreate(null, null)
    }
  }, [pendingPrompt, setPendingExpertCreate])

  /** 模式点击只切换选中态（对齐 demo），目录由展开面板里的按钮选择 */
  const handleModeSelect = (mode: "free" | "project") => {
    setSelectedMode(mode)
    if (mode === "free") setProjectPath(null)
  }

  const pickDirectory = async () => {
    const picked = await window.nexa.openDirectoryPicker()
    if (picked) setProjectPath(picked as string)
  }

  const handleSend = async (finalText: string, opts: { expertId?: string; attachments?: AttachmentInput[] }): Promise<boolean> => {
    if ((!finalText.trim() && !opts.attachments?.length) || loading) return false
    if (selectedMode === "project" && !projectPath) {
      setError("请先选择要操作的项目目录")
      return false
    }
    setLoading(true)
    setError(null)
    try {
      await createSession({ initialMessage: finalText.trim(), mode: selectedMode, model: currentModel, projectPath: selectedMode === "project" ? projectPath ?? undefined : undefined, expertId: opts.expertId ?? currentExpertId, attachments: opts.attachments })
      setText("")
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex h-full flex-1 flex-col bg-background">
      {/* 顶部窗口拖动热区（64px） */}
      <div className="drag-bar h-16 shrink-0" />

      {/* 主内容区 */}
      <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <LogoIcon className="h-9 w-9" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Nexa</h1>
            <p className="mt-1 text-sm text-muted-foreground">你的智能工作助手，随时待命</p>
          </div>
        </div>

        {/* 模式选择（点击仅切换选中，对齐 demo） */}
        <div className="grid w-full max-w-4xl grid-cols-2 gap-6">
          <ModeCard
            icon={<Terminal className="h-5 w-5" />}
            title="自由任务"
            desc={
              <>
                写报告、数据分析、调研、规划…
                <br />
                系统自动创建隔离工作区
                <code className="mt-1 block rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-primary">~/.nexa/workspaces/&lt;uuid&gt;/</code>
              </>
            }
            selected={selectedMode === "free"}
            onClick={() => handleModeSelect("free")}
            disabled={loading}
          />
          <ModeCard
            icon={<Bot className="h-5 w-5" />}
            title="项目编码"
            desc={
              <>
                在已有项目上改代码
                <br />
                比如：&quot;xxx 目录下帮我加会员能力&quot;
              </>
            }
            selected={selectedMode === "project"}
            onClick={() => handleModeSelect("project")}
            disabled={loading}
          />
        </div>

        {/* 项目目录选择（仅项目编码模式展开，对齐 demo） */}
        {selectedMode === "project" && (
          <div className="w-full max-w-4xl rounded-xl border border-border bg-muted/40 p-4">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <FolderOpen className="h-3.5 w-3.5" />
              选择要操作的项目目录
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
                {projectPath ?? "未选择目录"}
              </div>
              <Button variant="outline" size="sm" onClick={() => void pickDirectory()} disabled={loading}>
                选择目录...
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              Nexa 会扫描这个目录（自动读 AGENTS.md / README.md 等），然后在上面工作。
              <br />
              会话删除时不会清理这个目录——你的项目代码安全。
            </p>
          </div>
        )}
      </div>

      {/* 底部输入框（固定在页面底部，24px 外边距） */}
      <div className="shrink-0 px-6 pb-6">
        <div className="mx-auto w-full max-w-4xl">
          <InputBar
            value={text}
            onChange={setText}
            onSend={handleSend}
            loading={loading}
            placeholder={
              selectedMode === "project"
                ? projectPath
                  ? "描述编码任务（项目目录已选择）…"
                  : "描述编码任务（请先选择项目目录）…"
                : "描述你的任务..."
            }
            currentExpertId={currentExpertId}
            defaultSkillId={pendingSkillId}
          />
          {error && (
            <p className="mt-2 text-center text-xs text-red-500">{error}</p>
          )}
        </div>
      </div>
    </main>
  )
}

function ModeCard({
  icon,
  title,
  desc,
  selected,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  title: string
  desc: React.ReactNode
  selected?: boolean
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && onClick) {
          e.preventDefault()
          onClick()
        }
      }}
      className={cn(
        "flex cursor-pointer flex-col items-start gap-2 rounded-xl border-2 p-4 text-left shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary bg-primary/5"
          : "hover:border-muted-foreground/40",
        disabled && "pointer-events-none opacity-50"
      )}
    >
      <div className="flex w-full items-center gap-2">
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-md", selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
          {icon}
        </div>
        <p className={cn("text-sm font-semibold", selected && "text-primary")}>{title}</p>
        {selected && (
          <span className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-2.5 w-2.5" />
          </span>
        )}
      </div>
      <div className="text-xs leading-relaxed text-muted-foreground">{desc}</div>
    </Card>
  )
}

// ==========================================
// 会话视图 —— 有 currentSessionId 时显示
// ==========================================
function ConversationView({ conv }: { conv: Conversation }) {
  const sendMessage = useConversationStore((s) => s.sendMessage)
  const pauseSession = useConversationStore((s) => s.pauseSession)
  const resumeSession = useConversationStore((s) => s.resumeSession)
  const selectSession = useConversationStore((s) => s.selectSession)
  /** 已归档会话只读: 隐藏底部输入框，禁止继续对话 */
  const isArchived = useConversationStore((s) => s.sessionList.find((x) => x.id === conv.id)?.archived ?? false)

  const [input, setInput] = useState("")
  const [sendError, setSendError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  /** 用户是否在底部附近（100px 以内）——用来控制是否自动滚动 */
  const isAtBottomRef = useRef(true)

  // 监听滚动容器，判断用户是否在底部
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const { scrollTop, clientHeight, scrollHeight } = el
    isAtBottomRef.current = scrollTop + clientHeight >= scrollHeight - 100
  }, [])

  // 自动滚动到底部（只在用户在底部附近时才滚）
  useEffect(() => {
    if (!isAtBottomRef.current) return
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [conv.messages.length, conv.messages[conv.messages.length - 1]?.content])

  // 切换会话时重置滚动状态 + 加载历史
  useEffect(() => {
    isAtBottomRef.current = true
    if (conv.id && conv.messages.length === 0) {
      void selectSession(conv.id)
    }
  }, [conv.id, conv.messages.length, selectSession])

  const isRunning = conv.status === "running"
  const isPaused = conv.status === "paused"
  const isFailed = conv.status === "failed"
  /** 最后一条 user 消息，失败重试时重发 */
  const lastUserMessage = [...conv.messages].reverse().find((m) => m.role === "user")

  /**
   * 产物卡片的挂载锚点：非运行中时取最后一条有正文的 assistant 消息，
   * 产物卡内联在该消息正文之后（不再单独占一行）；运行中不展示（文件仍在写入）
   */
  const artifactAnchorId = useMemo(() => {
    if (isRunning) return null
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const m = conv.messages[i]
      if (m.role === "assistant" && m.content.trim()) return m.id
    }
    return null
  }, [conv.messages, isRunning])

  const handleSend = async (finalText: string, opts: { expertId?: string; attachments?: AttachmentInput[] }): Promise<boolean> => {
    if ((!finalText.trim() && !opts.attachments?.length) || isRunning || isArchived) return false
    setSendError(null)
    // 附加了专家: 与当前不同则先切换（下一轮生效）
    if (opts.expertId && opts.expertId !== conv.currentExpert) {
      await window.nexa.sessionSetExpert({ sessionId: conv.id, expertId: opts.expertId })
    }
    const ok = await sendMessage(conv.id, finalText.trim(), opts.attachments)
    if (ok) setInput("")
    else setSendError("发送失败：会话不可用或正在运行")
    return ok
  }

  /** 失败重试：重发最后一条 user 消息 */
  const handleRetry = async () => {
    if (isRunning || isArchived || !lastUserMessage) return
    setSendError(null)
    const ok = await sendMessage(conv.id, lastUserMessage.content)
    if (!ok) setSendError("重试失败：会话不可用或正在运行")
  }

  return (
    <main className="flex h-full flex-1 flex-col bg-background">
      {/* 顶栏（自身可拖动窗口，内部控件以 no-drag 豁免） */}
      <div className="drag-bar shrink-0">
        <Topbar
          conv={conv}
          isRunning={isRunning}
          isPaused={isPaused}
          isFailed={isFailed}
          isArchived={isArchived}
          canRetry={Boolean(lastUserMessage)}
          onPause={() => void pauseSession(conv.id)}
          onResume={() => void resumeSession(conv.id)}
          onRetry={() => void handleRetry()}
        />
      </div>

      {/* 消息列表（宽度随窗口自适应延展，气泡自身限宽） */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-4">
        <ConversationContent>
          {conv.messages.length === 0 ? (
            isRunning ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">等待回复中...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <Bot className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">发送消息开始对话</p>
              </div>
            )
          ) : (
            buildRunGroups(conv.messages).map((group) => (
              <RunGroupView key={group.key} group={group} runs={conv.runs ?? {}} artifactAnchorId={artifactAnchorId} />
            ))
          )}
          <div ref={messagesEndRef} />
        </ConversationContent>
      </div>

      {/* 底部输入区（InputBar 独占整行；暂停/继续/重试已移入顶栏，删除入口在侧栏任务行菜单） */}
      {isArchived ? (
        <div className="flex h-[68px] shrink-0 items-center justify-center border-t border-border px-6">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Archive className="h-3.5 w-3.5" />
            会话已归档，仅可查看历史消息（任务列表中可取消归档）
          </p>
        </div>
      ) : (
        <div className="shrink-0 border-t border-border px-6 py-3">
          <div className="mx-auto w-full max-w-4xl">
            <InputBar
              value={input}
              onChange={setInput}
              onSend={handleSend}
              loading={isRunning}
              placeholder={isRunning ? "Agent 执行中..." : "继续对话..."}
              currentExpertId={conv.currentExpert}
              model={conv.model}
              sessionId={conv.id}
            />
            {sendError && (
              <p className="mt-2 text-xs text-red-500">{sendError}</p>
            )}
          </div>
        </div>
      )}
    </main>
  )
}

// ===== 顶部栏 =====
/** 顶栏右上角产物入口按钮: 图标 + 文件数徽标，点击唤出产物浮窗（无文件时点击拉取目录） */
function TopbarArtifactsButton({ sessionId }: { sessionId: string }) {
  const panelOpen = useArtifactsStore((s) => s.panelOpen)
  const setPanelOpen = useArtifactsStore((s) => s.setPanelOpen)
  const setPreviewOnly = useArtifactsStore((s) => s.setPreviewOnly)
  const tree = useArtifactsStore((s) => s.tree)
  const fetchTree = useArtifactsStore((s) => s.fetchTree)
  const fileCount = useMemo(() => countWorkspaceFiles(tree), [tree])

  return (
    <button
      onClick={() => {
        // 顶栏入口始终打开完整模式（文件树 + 预览），退出仅预览态
        setPreviewOnly(false)
        if (!panelOpen && tree.length === 0) void fetchTree(sessionId)
        setPanelOpen(!panelOpen)
      }}
      className={cn(
          "no-drag relative flex h-7 w-7 items-center justify-center rounded-md outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
          panelOpen ? "bg-accent text-foreground" : "text-muted-foreground"
        )}
        title="产物文件"
      aria-label="产物文件"
    >
      <FolderOpen className="h-4 w-4" />
      {fileCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
          {fileCount > 99 ? "99+" : fileCount}
        </span>
      )}
    </button>
  )
}

function Topbar({
  conv,
  isRunning,
  isPaused,
  isFailed,
  isArchived,
  canRetry,
  onPause,
  onResume,
  onRetry,
}: {
  conv: Conversation
  isRunning: boolean
  isPaused: boolean
  isFailed: boolean
  isArchived: boolean
  canRetry: boolean
  onPause: () => void
  onResume: () => void
  onRetry: () => void
}) {
  const statusColor = {
    running: "bg-primary",
    paused: "bg-muted-foreground",
    completed: "bg-emerald-500",
    failed: "bg-red-500",
  }[conv.status]
  const statusLabel = {
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
  }[conv.status]

  return (
    <div className="flex h-16 items-center gap-3 border-b border-border px-6">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", statusColor, conv.status === "running" && "animate-pulse")} />
        <span className="truncate text-sm font-medium">{conv.title}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {conv.mode === "free" ? "自由" : "项目"}
        </span>
        {conv.mode === "project" && conv.projectPath && (
          <span className="max-w-[180px] truncate text-[10px] text-muted-foreground" title={conv.projectPath}>
            {shortenPath(conv.projectPath)}
          </span>
        )}
        <span className="text-xs text-muted-foreground">{statusLabel}</span>
        {isArchived && (
          <span className="flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <Archive className="h-3 w-3" />
            已归档
          </span>
        )}
      </div>
      <div className="flex-1" />
      {/* 会话控制（从底部输入区移入顶栏；删除入口保留在侧栏任务行菜单） */}
      {isRunning && !isArchived && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onPause}
          aria-label="暂停"
          title="暂停"
          className="no-drag h-7 w-7 text-muted-foreground"
        >
          <Pause className="h-4 w-4" />
        </Button>
      )}
      {isPaused && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onResume}
          aria-label="继续"
          title="继续"
          className="no-drag h-7 w-7 text-muted-foreground"
        >
          <Play className="h-4 w-4" />
        </Button>
      )}
      {isFailed && canRetry && !isArchived && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onRetry}
          aria-label="重试"
          title="重发最后一条消息"
          className="no-drag h-7 w-7 text-muted-foreground"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      )}
      {/* 产物面板入口（WorkBuddy: 顶栏右上角图标唤出浮窗）；顶栏 drag，控件需 no-drag */}
      <TopbarArtifactsButton sessionId={conv.id} />
    </div>
  )
}

/** provider/modelId → 显示名（与 main/index.ts 的 availableModels 保持同步） */
function formatModelName(model: string): string {
  const map: Record<string, string> = {
    "deepseek/deepseek-v4-flash": "DeepSeek V4 Flash",
    "deepseek/deepseek-v4-pro": "DeepSeek V4 Pro",
    "deepseek/deepseek-v3.2": "DeepSeek V3.2",
  }
  return map[model] ?? model.split("/").pop() ?? model
}

/** 长路径缩略为最后两段: /a/b/c/d → c/d */
function shortenPath(p: string): string {
  const parts = p.split("/").filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : p
}

// ===== 输入框（共用） =====
/**
 * 输入框（shadcn 组件化）:
 * 上部 textarea 自适应高度；下部工具行 —— 左下角 + 菜单（选技能/专家）+ 已选 chips，右下角发送按钮
 */
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

function InputBar({
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
  const modelSupportsImage =
    availableModels.find((m) => m.id === effectiveModel)?.supportsImage ?? false

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
        {/* 模型选择（WorkBuddy: 发送按钮前） */}
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
        {/* 发送按钮（WorkBuddy: 圆形 + 向上箭头） */}
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

// ==========================================
// 任务轨迹（Run Trace）—— 参考 Claude Code / Cursor：
// 一条用户消息触发的一轮 agent loop 为一个任务；运行中流式展示思考/工具调用，
// 结束后自动收拢为「任务耗时 X分Y秒 · N 次工具调用」摘要条，点击展开完整过程，最终回答常显
// ==========================================

/** 消息按 user 边界切分为任务组（每组至多一条 user 消息 + 其后的 assistant/tool/plan/error） */
interface RunGroupData {
  key: string
  user: ChatMessage | null
  items: ChatMessage[]
}

function buildRunGroups(messages: ChatMessage[]): RunGroupData[] {
  const groups: RunGroupData[] = []
  let current: RunGroupData | null = null
  for (const m of messages) {
    if (m.role === "user") {
      current = { key: `run-${m.id}`, user: m, items: [] }
      groups.push(current)
    } else {
      if (!current) {
        current = { key: `run-pre-${m.id}`, user: null, items: [] }
        groups.push(current)
      }
      current.items.push(m)
    }
  }
  return groups
}

/** 耗时格式化：59秒 / 2分30秒 / 1小时05分 */
function formatRunDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total}秒`
  const mins = Math.floor(total / 60)
  const secs = total % 60
  if (mins < 60) return `${mins}分${secs}秒`
  return `${Math.floor(mins / 60)}小时${String(mins % 60).padStart(2, "0")}分`
}

function RunGroupView({
  group,
  runs,
  artifactAnchorId,
}: {
  group: RunGroupData
  runs: Record<string, AgentRunInfo>
  artifactAnchorId: string | null
}) {
  // 过滤纯工具轮次落库的空 assistant 行（无正文/无思考/非流式）
  const items = group.items.filter(
    (m) => !(m.role === "assistant" && !m.content.trim() && !m.thinking && !m.streaming)
  )

  // 组内 runId（新数据每条消息带 run_id；历史数据为 null，走兼容合成）
  const runId = items.find((m) => m.runId)?.runId ?? null
  const realRun = runId ? runs[runId] : undefined
  // 工具数取消息实时计数（运行中也准确），完成后与 run.toolCallCount 一致
  const toolCount = items.filter((m) => m.role === "tool").length
  const running = realRun?.status === "running"

  // 最终回答：完成后取最后一条有正文的 assistant 常显；运行中全部留在展开区避免时序错位
  let finalIdx = -1
  if (!running) {
    for (let i = items.length - 1; i >= 0; i--) {
      const m = items[i]
      if (m.role === "assistant" && (m.content.trim() || m.streaming)) {
        finalIdx = i
        break
      }
    }
  }

  // 没有工具调用的普通问答不显示轨迹条
  if (toolCount === 0) {
    return (
      <>
        {group.user && <MessageBubble key={group.user.id} msg={group.user} />}
        {items.map((m) => <MessageBubble key={m.id} msg={m} artifactAnchorId={artifactAnchorId} />)}
      </>
    )
  }

  // 历史数据无 agent_runs 记录：用组内消息时间戳合成轨迹元数据（秒级精度）
  const meta: AgentRunInfo = realRun ?? {
    id: group.key,
    status: "completed",
    startedAt: items[0]?.createdAt ?? Date.now(),
    durationMs: items.length >= 2 ? items[items.length - 1].createdAt - items[0].createdAt : 0,
    toolCallCount: toolCount,
  }
  const finalMsg = finalIdx >= 0 ? items[finalIdx] : null
  const traceItems = items.filter((_, i) => i !== finalIdx)

  return (
    <>
      {group.user && <MessageBubble key={group.user.id} msg={group.user} />}
      <RunTrace meta={meta} running={running} toolCount={toolCount} finalMsg={finalMsg} artifactAnchorId={artifactAnchorId}>
        {traceItems.map((m) => <MessageBubble key={m.id} msg={m} artifactAnchorId={artifactAnchorId} />)}
      </RunTrace>
    </>
  )
}

function RunTrace({
  meta,
  running,
  toolCount,
  finalMsg,
  artifactAnchorId,
  children,
}: {
  meta: AgentRunInfo
  running: boolean
  toolCount: number
  finalMsg: ChatMessage | null
  artifactAnchorId: string | null
  children: React.ReactNode
}) {
  // 运行中默认展开跟随；收到 run.finished 状态翻转时自动收拢
  const [open, setOpen] = useState(running)
  const prevRunning = useRef(running)
  useEffect(() => {
    if (prevRunning.current && !running) setOpen(false)
    prevRunning.current = running
  }, [running])

  const failed = meta.status === "failed"
  const paused = meta.status === "paused"

  const statusIcon = running ? (
    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
  ) : failed ? (
    <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
  ) : paused ? (
    <Pause className="h-3.5 w-3.5 shrink-0 text-amber-500" />
  ) : (
    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
  )

  const title = running
    ? "任务执行中…"
    : failed
      ? "任务失败"
      : paused
        ? "任务已暂停"
        : "任务耗时"
  const duration = !running && meta.durationMs !== undefined ? formatRunDuration(meta.durationMs) : null

  return (
    <>
      <Message from="assistant">
        <MessageAvatar />
        <div className="flex w-full min-w-0 flex-col gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
            {statusIcon}
            <span className="shrink-0 font-medium text-foreground">{title}</span>
            {duration && <span className="shrink-0 tabular-nums">{duration}</span>}
            <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 text-[11px]">
              <Terminal className="h-3 w-3" />
              {toolCount} 次工具调用
            </span>
          </button>
          {open && <div className="flex flex-col gap-2">{children}</div>}
        </div>
      </Message>
      {/* 最终回答常显（不随轨迹收拢） */}
      {finalMsg && <MessageBubble msg={finalMsg} artifactAnchorId={artifactAnchorId} />}
    </>
  )
}

function MessageBubble({ msg, artifactAnchorId }: { msg: ChatMessage; artifactAnchorId?: string | null }) {
  switch (msg.role) {
    case "user":
      return <UserBubble msg={msg} />
    case "assistant":
      return <AssistantBubble msg={msg} showArtifacts={msg.id === artifactAnchorId} />
    case "tool":
      return <ToolCallBubble msg={msg} />
    case "plan":
      return <PlanStepBubble msg={msg} />
    case "error":
      return <ErrorBubble msg={msg} />
    default:
      return null
  }
}

function UserBubble({ msg }: { msg: ChatMessage }) {
  /** 今天只显时间、昨天显示「昨天 HH:mm」、更早带完整日期 */
  const timeStr = formatMessageTime(msg.createdAt)
  return (
    <Message from="user">
      {/* 垂直布局: 气泡在上，时间+复制按钮在下右侧；hover 前已占位，避免抖动 */}
      {/* max-w 上限放在这一层（相对定宽的 Message 行解析）；若设在气泡上，父列 shrink-to-fit 会让百分比自我指涉，CJK 短消息被压窄换行 */}
      <div className="flex max-w-[80%] flex-col items-end gap-1">
        <MessageContent from="user">
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap justify-end gap-2">
              {msg.attachments.map((a) => (
                <AttachmentThumb key={a.path} att={a} />
              ))}
            </div>
          )}
          {msg.content && <p>{msg.content}</p>}
        </MessageContent>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            {timeStr}
          </span>
          <CopyButton text={msg.content} />
        </div>
      </div>
    </Message>
  )
}

function AssistantBubble({ msg, showArtifacts }: { msg: ChatMessage; showArtifacts?: boolean }) {
  const sessionId = useConversationStore((s) => s.currentSessionId)
  const hasThinking = Boolean(msg.thinking) || msg.thinkingStreaming === true
  return (
    <Message from="assistant">
      <MessageAvatar />
      <div className="flex w-full min-w-0 flex-col items-start gap-2">
        {/* 思考过程折叠条：流式中自动展开，完成后收拢可回看 */}
        {hasThinking && <Thinking content={msg.thinking ?? ""} streaming={msg.thinkingStreaming} />}
        {/* 正文（纯思考阶段 content 为空，不渲染空泡） */}
        {(msg.content || msg.streaming) && (
          <MessageContent from="assistant">
            {/* transition-opacity 平滑 streaming→done 切换时的 reflow */}
            <div key={msg.streaming ? "streaming" : "done"} className="transition-opacity duration-150">
              {msg.streaming ? (
                // streaming 期间：纯文本预览 + 闪烁光标，避免每次 delta 都跑 markdown 全量解析
                <StreamingPreview content={msg.content} />
              ) : (
                // done 后：完整 markdown 解析
                <Response content={msg.content} />
              )}
            </div>
            {/* 产物文件卡：内联在正文之后（仅挂在本轮最终回答上） */}
            {showArtifacts && sessionId && <ArtifactCards sessionId={sessionId} />}
          </MessageContent>
        )}
      </div>
      {!msg.streaming && msg.content && <CopyButton text={msg.content} className="mt-1.5" />}
    </Message>
  )
}

/** 用户消息附件缩略图（经 IPC 读取 ~/.nexa/uploads 内文件为 dataURL） */
function AttachmentThumb({ att }: { att: ChatAttachment }) {
  /** undefined = 加载中；null = 文件不可用（已删除等） */
  const [dataUrl, setDataUrl] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void window.nexa
      .attachmentRead(att.path)
      .then((d: unknown) => {
        if (alive) setDataUrl((d as string | null) ?? null)
      })
      .catch(() => {
        if (alive) setDataUrl(null)
      })
    return () => {
      alive = false
    }
  }, [att.path])

  if (dataUrl) {
    return (
      <img
        src={dataUrl}
        alt={att.name}
        title={`${att.name}\n${att.path}`}
        className="h-24 w-24 rounded-lg border border-border object-cover"
      />
    )
  }
  return (
    <div
      title={att.path}
      className="flex h-24 w-24 items-center justify-center rounded-lg border border-border bg-muted px-1 text-center text-[10px] leading-tight text-muted-foreground"
    >
      {dataUrl === undefined ? "加载中…" : "图片不可用"}
    </div>
  )
}

/** 气泡 hover 复制按钮：点击复制，成功后短暂显示 Check */
function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时静默失败
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={copied ? "已复制" : "复制"}
      title="复制"
      className={cn(
        "shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100",
        copied && "opacity-100",
        className
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

function ToolCallBubble({ msg }: { msg: ChatMessage }) {
  const tool = msg.toolCall
  if (!tool) return null
  return (
    // 与正文消息同构：头像位 + 铺满剩余宽度，保证工具卡与正文气泡宽度一致
    <Message from="assistant">
      <MessageAvatar />
      <Tool
        toolName={tool.toolName}
        args={tool.args}
        result={tool.result}
        success={tool.success}
        running={tool.success === undefined}
        durationMs={tool.durationMs}
      />
    </Message>
  )
}

function ErrorBubble({ msg }: { msg: ChatMessage }) {
  return (
    <div className="flex justify-center">
      <div className="max-w-[80%] rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-xs text-red-500">
        {msg.content}
      </div>
    </div>
  )
}

function PlanStepBubble({ msg }: { msg: ChatMessage }) {
  const steps = msg.plan?.steps ?? []
  if (steps.length === 0) return null

  return (
    <Message from="assistant">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <PlanCard steps={steps} />
    </Message>
  )
}
