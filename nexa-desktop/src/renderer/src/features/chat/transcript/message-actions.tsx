/** 消息级操作与元信息：复制按钮、模型/时间 footer */
import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"
import { cn, formatMessageTime } from "@renderer/lib/utils"

export function CopyButton({ text, className }: { text: string; className?: string }) {
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
      /* 剪贴板不可用时静默失败 */
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn("inline-flex items-center text-muted-foreground transition hover:text-foreground", className)}
      title={copied ? "已复制" : "复制"}
      aria-label={copied ? "已复制" : "复制"}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

export function MessageMeta({ model, createdAt }: { model?: string; createdAt: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
      {model ? <span className="font-mono">{model}</span> : null}
      {model ? <span>·</span> : null}
      <span>{formatMessageTime(createdAt)}</span>
    </div>
  )
}
