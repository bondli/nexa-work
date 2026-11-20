/**
 * 左侧消息缩略导航：每个 user turn 一个标记，点击平滑跳转，hover 显示预览，
 * 当前阅读位置高亮。仅在「用户消息超过 3 条」且内容溢出一屏时挂载。
 * 借鉴 PI-Desktop ConversationMinimap，简化动效，保留跳转/预览/高亮核心。
 */
import { useEffect, useState } from "react"
import type { Turn } from "../lib/build-turns"

interface ConversationMinimapProps {
  turns: Turn[]
  // useRef<HTMLDivElement>(null) 在 React 19 类型下推断为 RefObject<HTMLDivElement | null>
  scrollRef: React.RefObject<HTMLDivElement | null>
  /** 跳转前调用：释放滚动跟随，避免被流式拉回底部 */
  onJump: () => void
}

export function ConversationMinimap({ turns, scrollRef, onJump }: ConversationMinimapProps) {
  const [overflow, setOverflow] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)

  const markers = turns.filter((t) => t.user)

  // 溢出检测 + 滚动高亮当前位置（rAF 节流）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const items = turns.filter((t) => t.user)
    let raf = 0
    const update = () => {
      setOverflow(el.scrollHeight > el.clientHeight + 50)
      // 以视口 35% 处为参考点，取距离最近的 turn 作为当前阅读位置
      const target = el.scrollTop + el.clientHeight * 0.35
      const rect = el.getBoundingClientRect()
      let best: string | null = null
      let bestDist = Infinity
      for (const t of items) {
        const node = el.querySelector(`[data-turn-id="${CSS.escape(t.id)}"]`) as HTMLElement | null
        if (!node) continue
        const top = node.getBoundingClientRect().top - rect.top + el.scrollTop
        const dist = Math.abs(top - target)
        if (dist < bestDist) {
          bestDist = dist
          best = t.id
        }
      }
      setActiveId(best)
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(update)
    }
    update()
    el.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef, turns])

  const handleClick = (id: string) => {
    const el = scrollRef.current
    if (!el) return
    onJump()
    const node = el.querySelector(`[data-turn-id="${CSS.escape(id)}"]`) as HTMLElement | null
    node?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  // 一次对话（≤3 条用户消息）不显示；内容未溢出一屏也不显示
  if (!overflow || markers.length <= 3) return null

  return (
    <div
      className="absolute left-1 top-1/2 z-10 flex w-3 -translate-y-1/2 flex-col items-center gap-1.5"
      onMouseLeave={() => setHoverId(null)}
    >
      {markers.map((t, i) => {
        const active = t.id === activeId
        const hover = t.id === hoverId
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => handleClick(t.id)}
            onMouseEnter={() => setHoverId(t.id)}
            className="group relative block"
            aria-label={`跳转到第 ${i + 1} 轮`}
          >
            <span
              className={
                "block rounded-full transition-all " +
                (active
                  ? "h-3 w-3 bg-primary"
                  : hover
                    ? "h-2.5 w-2.5 bg-foreground/60"
                    : "h-2 w-2 bg-muted-foreground/30")
              }
            />
            {hover && (
              <div className="pointer-events-none absolute left-5 top-1/2 z-20 w-72 -translate-y-1/2 rounded-md border border-border bg-card px-2.5 py-2 text-left text-[11px] leading-relaxed shadow-lg">
                <div className="mb-0.5 text-[10px] font-medium text-muted-foreground">第 {i + 1} 轮</div>
                <div className="line-clamp-5 whitespace-pre-wrap break-words text-foreground">
                  {t.user?.content || "（无文本内容）"}
                </div>
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}
