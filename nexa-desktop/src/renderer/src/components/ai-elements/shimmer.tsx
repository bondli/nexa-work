/**
 * shadcn ai-elements 本地实现：shimmer 文字动效
 * 对齐 https://ui.shadcn.com/docs/utils/shimmer —— 用于「思考中」「执行中」这类进行态文案
 */
import { cn } from "@renderer/lib/utils"

export function Shimmer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("ai-shimmer", className)}>{children}</span>
}
