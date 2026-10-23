/**
 * shadcn ai-elements 本地实现：Tool（工具调用）
 * 对齐 https://ui.shadcn.com/docs/ai-elements/base/tool
 *
 * 折叠态是一行「状态 + 工具名 + 关键参数 + 耗时」，展开后看完整输入/输出。
 * 工具图标按名称归类，避免所有调用都长成同一个终端图标。
 */
import { useState } from "react"
import {
  Check,
  ChevronDown,
  FileText,
  FolderOpen,
  Globe,
  Loader2,
  Pencil,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  X,
} from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { Shimmer } from "@renderer/components/ai-elements/shimmer"

/** 按工具名推断语义图标（内置工具命名见 src/main/agent/tools.ts） */
function toolIcon(toolName: string) {
  const n = toolName.toLowerCase()
  if (n.includes("bash") || n.includes("shell") || n.includes("terminal")) return Terminal
  if (n.includes("read") || n.includes("write") || n.includes("edit") || n.includes("file")) return FileText
  if (n.includes("search") || n.includes("grep") || n.includes("find") || n.includes("query")) return Search
  if (n.includes("web") || n.includes("http") || n.includes("fetch")) return Globe
  if (n.includes("list") || n.includes("dir") || n.includes("workspace")) return FolderOpen
  if (n.includes("skill") || n.includes("expert")) return Sparkles
  if (n.includes("memory") || n.includes("note") || n.includes("kb")) return Pencil
  return Wrench
}

/** 从参数对象里挑最值得展示的字段，一行概括这次调用在做什么 */
function summarizeArgs(args: unknown): string {
  if (args == null) return ""
  if (typeof args === "string") return args
  if (typeof args !== "object") return String(args)
  const o = args as Record<string, unknown>
  const keys = ["command", "path", "file_path", "query", "url", "pattern", "description", "prompt", "name", "title"]
  for (const k of keys) {
    const v = o[k]
    if (typeof v === "string" && v.trim()) return v
  }
  try {
    return JSON.stringify(args)
  } catch {
    return ""
  }
}

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
  const Icon = toolIcon(toolName)
  const summary = summarizeArgs(args)
  const argsText = args !== undefined ? JSON.stringify(args, null, 2) : ""
  const resultText = result !== undefined ? JSON.stringify(result, null, 2) : ""

  const statusIcon = running ? (
    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
  ) : success ? (
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
      <Check className="h-2.5 w-2.5 text-emerald-500" />
    </span>
  ) : (
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-destructive/15">
      <X className="h-2.5 w-2.5 text-destructive" />
    </span>
  )

  return (
    <div className={cn("w-full overflow-hidden rounded-lg border border-border/70 bg-muted/25", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {statusIcon}
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium text-foreground">{toolName}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{summary}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          {running ? (
            <Shimmer>执行中</Shimmer>
          ) : (
            <>
              <span className={cn(success ? "text-emerald-500" : "text-destructive")}>{success ? "成功" : "失败"}</span>
              {durationMs !== undefined && <span>· {(durationMs / 1000).toFixed(1)}s</span>}
            </>
          )}
          <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && !running && (
        <div className="space-y-2 border-t border-border/70 px-2.5 py-2">
          <Section label="输入" text={argsText || "（无）"} />
          <Section label="输出" text={resultText || "（无输出）"} />
        </div>
      )}
    </div>
  )
}

function Section({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground/80">
        {text}
      </pre>
    </div>
  )
}
