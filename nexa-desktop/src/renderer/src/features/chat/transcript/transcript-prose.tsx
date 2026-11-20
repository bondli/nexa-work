/**
 * 会话正文渲染：流式期间用纯文本 + 光标（避免每帧解析 markdown 卡顿），
 * 完成后切到 MarkdownRenderer 并带淡入；非流式时基于滚动容器视口做离屏卸载
 * （滚出视口的长文替换为测高占位，避免大会话全量挂载 markdown）。
 *
 * 视口检测依赖滚动容器带 `data-transcript-scroll` 属性（由 ChatTranscript 根容器设置）。
 */
import { useEffect, useRef, useState } from "react"
import { cn } from "@renderer/lib/utils"
import { MarkdownRenderer } from "@renderer/components/markdown-renderer"

interface TranscriptProseProps {
  content: string
  /** 流式中：渲染纯文本预览 + 光标，且始终挂载（不参与离屏卸载） */
  streaming?: boolean
  className?: string
}

function getScrollRoot(el: HTMLElement): HTMLElement | null {
  return el.closest("[data-transcript-scroll]") as HTMLElement | null
}

export function TranscriptProse({ content, streaming, className }: TranscriptProseProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)
  const [height, setHeight] = useState<number | null>(null)

  // 内容挂载时测量高度（供离屏占位用）
  useEffect(() => {
    if (!visible) return
    const el = wrapRef.current
    if (!el) return
    const measure = () => setHeight(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [visible, content])

  // 视口可见性：仅当非流式时才允许卸载到占位
  useEffect(() => {
    if (streaming) {
      setVisible(true)
      return
    }
    const el = wrapRef.current
    if (!el) return
    const root = getScrollRoot(el)
    if (!root) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setVisible(e.isIntersecting)
      },
      { root, rootMargin: "400px 0px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [streaming])

  return (
    <div
      ref={wrapRef}
      className={className}
      aria-hidden={!visible}
      style={!visible && height != null ? { height } : undefined}
    >
      {visible ? (
        streaming ? (
          <StreamingText content={content} />
        ) : (
          <div className="animate-[fadeIn_0.2s_ease]">
            <MarkdownRenderer content={content} />
          </div>
        )
      ) : null}
    </div>
  )
}

function StreamingText({ content }: { content: string }) {
  return (
    <div className="whitespace-pre-wrap break-words text-[length:var(--chat-font-size,14px)] leading-relaxed">
      {content}
      <span className="ml-0.5 inline-block h-4 w-[3px] translate-y-0.5 animate-pulse bg-muted-foreground/60 align-middle" />
    </div>
  )
}
