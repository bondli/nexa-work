/**
 * 会话滚动跟随：流式时贴近底部自动滚动；用户上滑释放跟随并显示「回到底部」按钮；
 * 切换会话时重置并滚到底。
 */
import { useCallback, useEffect, useRef, useState } from "react"

/** 距底部多少 px 以内视为「在底部」（跟随阈值） */
const NEAR_BOTTOM_THRESHOLD = 120

export function useTranscriptScroll(sessionId: string | null) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const isNearBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  /** 滚动事件：不在底部即视为用户在查看历史 → 释放跟随 + 显示按钮 */
  const onScroll = useCallback(() => {
    if (isNearBottom()) {
      if (!followRef.current) {
        followRef.current = true
        setShowJump(false)
      }
    } else {
      followRef.current = false
      setShowJump(true)
    }
  }, [isNearBottom])

  /** 供流式调用：仅在跟随模式下滚到底部 */
  const followIfNeeded = useCallback(() => {
    if (followRef.current) scrollToBottom("auto")
  }, [scrollToBottom])

  const jumpToLatest = useCallback(() => {
    followRef.current = true
    setShowJump(false)
    scrollToBottom("smooth")
  }, [scrollToBottom])

  /** 供 minimap 等外部跳转调用：跳转到指定位置并释放跟随 */
  const releaseFollow = useCallback(() => {
    followRef.current = false
    setShowJump(true)
  }, [])

  /** 会话切换：重置跟随并滚到底（等内容渲染后执行） */
  useEffect(() => {
    followRef.current = true
    setShowJump(false)
    const t = window.setTimeout(() => scrollToBottom("auto"), 0)
    return () => window.clearTimeout(t)
  }, [sessionId, scrollToBottom])

  return { scrollRef, onScroll, showJump, jumpToLatest, followIfNeeded, releaseFollow, scrollToBottom, isNearBottom }
}
