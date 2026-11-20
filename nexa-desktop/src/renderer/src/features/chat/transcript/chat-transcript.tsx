/**
 * 消息区根容器：组装滚动容器 + turns 列表 + minimap + 回到底部按钮。
 * 滚动逻辑由 useTranscriptScroll 统一管理；turn 投影在 chat-shell 完成后传入。
 */
import { useEffect, useMemo } from "react"
import { Bot, Loader2 } from "lucide-react"
import type { Turn } from "../lib/build-turns"
import { clearUserDisclosureChoices } from "./disclosure"
import { useTranscriptScroll } from "../hooks/use-transcript-scroll"
import { AssistantTurn } from "./assistant-turn"
import { JumpToLatest } from "./jump-to-latest"
import { ConversationMinimap } from "./conversation-minimap"

export function ChatTranscript({ sessionId, turns }: { sessionId: string; turns: Turn[] }) {
  const { scrollRef, onScroll, showJump, jumpToLatest, followIfNeeded, releaseFollow } = useTranscriptScroll(sessionId)
  const running = turns.some((t) => t.running)

  // 切换会话清空折叠记忆
  useEffect(() => {
    clearUserDisclosureChoices()
  }, [sessionId])

  // 流式 / 新消息时跟随到底部（仅在跟随模式下生效）
  useEffect(() => {
    followIfNeeded()
  }, [turns, followIfNeeded])

  // 最后一个有 answer 的 turn 挂产物卡片
  const lastAnswerTurnId = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].answer) return turns[i].id
    }
    return null
  }, [turns])

  return (
    <div className="relative flex min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        data-transcript-scroll
        className="flex-1 overflow-y-auto px-6 py-4"
      >
        <div className="relative mx-auto flex w-full max-w-3xl flex-col gap-6 pb-8">
          {turns.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              {running ? (
                <>
                  <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">等待回复中...</p>
                </>
              ) : (
                <>
                  <Bot className="h-10 w-10 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">发送消息开始对话</p>
                </>
              )}
            </div>
          ) : (
            turns.map((t) => (
              <AssistantTurn
                key={t.id}
                turn={t}
                sessionId={sessionId}
                showArtifacts={t.id === lastAnswerTurnId}
              />
            ))
          )}
        </div>
      </div>
      <ConversationMinimap turns={turns} scrollRef={scrollRef} onJump={releaseFollow} />
      {showJump && <JumpToLatest onClick={jumpToLatest} />}
    </div>
  )
}
