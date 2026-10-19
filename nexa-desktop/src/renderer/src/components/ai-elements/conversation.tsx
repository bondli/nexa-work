/**
 * shadcn ai-elements 本地实现（对齐 https://ui.shadcn.com/docs/ai-elements 的组件 API）:
 * Conversation / ConversationContent / Message / MessageContent / Response / Tool / Thinking / PlanCard
 * Response 内部复用 MarkdownRenderer（等价官方 streamdown 的 GFM 能力，零额外依赖）
 */
import { useEffect, useRef, useState } from "react"
import { Bot, Brain, CheckCircle2, ChevronDown, Circle, Loader2, Sparkles, Terminal, XCircle } from "lucide-react"
import { MarkdownRenderer } from "@renderer/components/markdown-renderer"
import { cn } from "@renderer/lib/utils"

/** 会话消息根容器 */
export function Conversation({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex w-full flex-col", className)}>{children}</div>
}

/** 会话滚动区（滚动控制在 ChatShell 内通过 ref 完成） */
export function ConversationContent({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex w-full flex-col gap-4", className)} {...props}>
      {children}
    </div>
  )
}

/** 单条消息行: from=user 右对齐, from=assistant 左对齐带头像位 */
export function Message({
  from,
  children,
  className,
}: {
  from: "user" | "assistant"
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "group flex items-start gap-2",
        from === "user" ? "justify-end" : "justify-start",
        className
      )}
    >
      {children}
    </div>
  )
}

/** 助手头像（assistant 消息行首） */
export function MessageAvatar({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary", className)}>
      <Bot className="h-3.5 w-3.5" />
    </div>
  )
}

/** 消息内容气泡: user 实底主色, assistant 描边卡片; 字号跟随 --chat-font-size */
export function MessageContent({
  from,
  children,
  className,
}: {
  from: "user" | "assistant"
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl px-4 py-2.5 text-[length:var(--chat-font-size,14px)] leading-relaxed transition-opacity duration-150",
        from === "user"
          ? "bg-primary text-primary-foreground [&_p]:whitespace-pre-wrap"
          : "w-full border border-border bg-card",
        className
      )}
    >
      {children}
    </div>
  )
}

/** Markdown 响应体（done 后的完整解析渲染） */
export function Response({ content, className }: { content: string; className?: string }) {
  return <MarkdownRenderer content={content} className={className} />
}

/** 流式预览: 纯文本 + 闪烁光标，避免 delta 高频全量 markdown 解析 */
export function StreamingPreview({ content }: { content: string }) {
  return (
    <div className="markdown-streaming-preview">
      {content || ""}
      <span className="agent-caret" />
    </div>
  )
}

/** 思考过程折叠条 —— 流式中自动展开跟随，完成后自动收拢，点击可回看 */
export function Thinking({ content, streaming }: { content: string; streaming?: boolean }) {
  const [open, setOpen] = useState(Boolean(streaming))
  const wasStreaming = useRef(Boolean(streaming))
  // 流式 → 完成 的瞬间自动收拢（回看时 streaming=undefined 不触发）
  useEffect(() => {
    if (wasStreaming.current && !streaming) setOpen(false)
    wasStreaming.current = Boolean(streaming)
  }, [streaming])

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border/60 bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")} />
        <Brain className="h-3 w-3 shrink-0" />
        <span className="font-medium">{streaming ? "思考中…" : "思考过程"}</span>
        {streaming && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      </button>
      {open && (
        <div className="border-t border-border/60 px-3 py-2">
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
            {content || "…"}
            {streaming && <span className="agent-caret" />}
          </pre>
        </div>
      )}
    </div>
  )
}

/** 工具调用卡片（可折叠）—— 对齐 ai-elements Tool 的展示语义；与正文同列等宽，展开内容自动换行 */
export function Tool({
  toolName,
  args,
  result,
  success,
  running,
  durationMs,
  className,
}: {
  toolName: string
  args?: unknown
  result?: unknown
  success?: boolean
  running?: boolean
  durationMs?: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const argsText = args !== undefined ? JSON.stringify(args, null, 2) : ""
  const resultText = result !== undefined ? JSON.stringify(result, null, 2) : ""
  return (
    <div className={cn("w-full overflow-hidden rounded-lg border border-border bg-muted/40", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")} />
        {running ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
        ) : success ? (
          <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
        ) : (
          <XCircle className="h-3 w-3 shrink-0 text-red-500" />
        )}
        <Terminal className="h-3 w-3 shrink-0" />
        <span className="shrink-0 font-medium text-foreground">{toolName}</span>
        <span className="truncate opacity-70">{args !== undefined ? JSON.stringify(args).slice(0, 60) : ""}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 text-[10px]">
          {running ? (
            <>
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              执行中
            </>
          ) : (
            <span className={cn(success ? "text-emerald-500" : "text-red-500")}>
              {success ? "成功" : "失败"}
              {durationMs !== undefined && ` · ${(durationMs / 1000).toFixed(1)}s`}
            </span>
          )}
        </span>
      </button>
      {open && !running && (
        <div className="space-y-2 border-t border-border px-3 py-2 text-xs">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">参数</div>
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
              {argsText || "（无）"}
            </pre>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">结果</div>
            <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
              {resultText || "（无输出）"}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

/** 执行计划卡片（plan 角色） */
export function PlanCard({ steps }: { steps: { id: string; description: string; status: string }[] }) {
  if (steps.length === 0) return null
  const statusIcon = (status: string) => {
    switch (status) {
      case "done":
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
      case "active":
        return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
      case "failed":
        return <XCircle className="h-3.5 w-3.5 text-red-500" />
      default:
        return <Circle className="h-3.5 w-3.5 text-muted-foreground" />
    }
  }
  const statusLabel: Record<string, string> = {
    pending: "待执行",
    active: "执行中",
    done: "已完成",
    failed: "失败",
  }
  return (
    <div className="w-full rounded-xl border border-border bg-card px-4 py-3 text-[length:var(--chat-font-size,14px)]">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Sparkles className="h-3 w-3" />
        执行计划
      </div>
      <ol className="space-y-1.5">
        {steps.map((step) => (
          <li
            key={step.id}
            className={cn(
              "flex items-start gap-2 rounded-md px-2 py-1",
              step.status === "active" && "bg-primary/5"
            )}
          >
            <span className="mt-0.5">{statusIcon(step.status)}</span>
            <div className="flex-1">
              <span
                className={cn(
                  step.status === "done" && "text-muted-foreground line-through",
                  step.status === "failed" && "text-red-500"
                )}
              >
                {step.description}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground">{statusLabel[step.status] ?? step.status}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
