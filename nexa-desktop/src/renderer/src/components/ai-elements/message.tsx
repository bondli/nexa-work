/**
 * shadcn ai-elements 本地实现：Message 模式
 * 对齐 https://ui.shadcn.com/docs/ai-elements/base/message
 *
 * 与旧版气泡的差异：助手消息改为「头像 + 名称/模型 + 正文 + 操作栏」的 agentic 结构，
 * 正文不再套描边卡片（长回答更像文档而不是聊天气泡），用户消息保留右侧实底气泡。
 */
import { UserRound } from "lucide-react"
import { LogoIcon } from "@renderer/components/logo-icon"
import { MarkdownRenderer } from "@renderer/components/markdown-renderer"
import { cn } from "@renderer/lib/utils"

/** 单条消息行：user 右对齐，assistant 左对齐带头像位 */
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
        "group flex w-full items-start gap-2.5",
        from === "user" ? "justify-end" : "justify-start",
        className
      )}
    >
      {children}
    </div>
  )
}

/** 消息头像：助手用应用 Logo，用户消息通常不渲染 */
export function MessageAvatar({ from = "assistant", className }: { from?: "user" | "assistant"; className?: string }) {
  return (
    <div
      className={cn(
        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
        from === "user" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
        className
      )}
    >
      {from === "user" ? <UserRound className="h-3.5 w-3.5" /> : <LogoIcon className="h-4 w-4" />}
    </div>
  )
}

/** 消息头部：名称 / 模型标记 / 时间 */
export function MessageHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex h-5 items-center gap-1.5 text-[11px] text-muted-foreground", className)}>{children}</div>
}

/** 消息操作栏：hover 时才显现，避免默认态噪声 */
export function MessageActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1.5 text-[10px] text-muted-foreground", className)}>{children}</div>
  )
}

/** 用户消息气泡：实底主色；助手正文直接用 Response，不套气泡 */
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
        "min-w-0 text-[length:var(--chat-font-size,14px)] leading-relaxed transition-opacity duration-150",
        from === "user"
          ? "rounded-2xl rounded-tr-md bg-primary px-4 py-2.5 text-primary-foreground [&_p]:whitespace-pre-wrap"
          : "w-full",
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

/** 流式预览：纯文本 + 闪烁光标，避免每个 delta 都跑一次完整 markdown 解析 */
export function StreamingPreview({ content }: { content: string }) {
  return (
    <div className="markdown-streaming-preview text-[length:var(--chat-font-size,14px)] leading-relaxed">
      {content || ""}
      <span className="agent-caret" />
    </div>
  )
}
