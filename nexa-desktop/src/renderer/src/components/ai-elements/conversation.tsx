/**
 * shadcn ai-elements 本地实现：会话容器
 * 对齐 https://ui.shadcn.com/docs/ai-elements/base/chat
 *
 * 消息渲染拆到 message / reasoning / tool / task / plan 各文件，
 * 这里只保留滚动区容器（滚动控制由 ChatShell 的 ref 负责）。
 */
import { cn } from "@renderer/lib/utils"

/** 会话根容器 */
export function Conversation({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex w-full flex-col", className)}>{children}</div>
}

/** 会话内容列表 */
export function ConversationContent({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex w-full flex-col gap-5", className)} {...props}>
      {children}
    </div>
  )
}
