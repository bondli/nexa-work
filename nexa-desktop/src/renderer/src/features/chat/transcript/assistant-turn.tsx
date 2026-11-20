/**
 * 单轮（turn）渲染：用户气泡 + 助手头像 + 过程折叠头（TurnProcess）+ 最终回答 + footer。
 * 用 memo + 自定义比较保证流式时历史 turn 不重渲染。
 */
import { memo } from "react"
import { LogoIcon } from "@renderer/components/logo-icon"
import type { Turn } from "../lib/build-turns"
import { areTurnsRenderEqual } from "../lib/turn-compare"
import { UserBubble } from "./user-bubble"
import { TurnProcess } from "./turn-process"
import { TranscriptProse } from "./transcript-prose"
import { CopyButton, MessageMeta } from "./message-actions"
import { UsageCapsule } from "./usage-capsule"
import { ArtifactCards } from "../artifact-cards"

interface AssistantTurnProps {
  turn: Turn
  sessionId: string
  /** 是否在该轮回答后挂载产物卡片（仅最后一轮非运行时为 true） */
  showArtifacts: boolean
}

function AssistantTurnImpl({ turn, sessionId, showArtifacts }: AssistantTurnProps) {
  return (
    <div className="flex flex-col gap-3" data-turn-id={turn.id}>
      {turn.user && <UserBubble message={turn.user} />}
      <div className="flex flex-col gap-2">
        {/* 上下结构：上方应用图标 + Nexa 文案，下方消息内容 */}
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
            <LogoIcon className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium">Nexa</span>
        </div>
        <div className="min-w-0">
          <TurnProcess turn={turn} />
          {turn.answer && (
            <div className="mt-2">
              <TranscriptProse content={turn.answer.content} streaming={turn.answer.streaming} />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <CopyButton text={turn.answer.content} />
                <MessageMeta model={turn.answer.model} createdAt={turn.answer.createdAt} />
                <div className="ml-auto">
                  <UsageCapsule usage={turn.answer.usage} durationMs={turn.run.durationMs} />
                </div>
              </div>
              {showArtifacts && !turn.running && <ArtifactCards sessionId={sessionId} />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export const AssistantTurn = memo(AssistantTurnImpl, (a, b) => {
  if (a.sessionId !== b.sessionId || a.showArtifacts !== b.showArtifacts) return false
  return areTurnsRenderEqual(a.turn, b.turn)
})
