/** turn 过程内容：按片段类型分发到对应渲染块；受 showThinking 偏好过滤 */
import type { Turn, TurnProcessPart } from "../lib/build-turns"
import { useTranscriptPrefs } from "../stores/transcript-prefs"
import { ThinkingBlock } from "./thinking-block"
import { ToolCallRow } from "./tool-call-row"
import { PlanStepsBlock } from "./plan-steps"
import { TextBubble } from "./text-bubble"
import { ErrorBubble } from "./error-bubble"

export function ProcessContent({ turn }: { turn: Turn }) {
  const showThinking = useTranscriptPrefs((s) => s.showThinking)
  return (
    <div className="flex flex-col gap-1.5">
      {turn.processParts.map((part, i) => {
        if (part.kind === "thinking" && !showThinking) return null
        return <ProcessPartRow key={`${part.message.id}-${i}`} part={part} />
      })}
    </div>
  )
}

function ProcessPartRow({ part }: { part: TurnProcessPart }) {
  switch (part.kind) {
    case "thinking":
      return <ThinkingBlock messageId={part.message.id} thinking={part.thinking} streaming={part.streaming} />
    case "tool":
      return <ToolCallRow message={part.message} />
    case "plan":
      return <PlanStepsBlock steps={part.steps} />
    case "text":
      return <TextBubble message={part.message} />
    case "error":
      return <ErrorBubble content={part.message.content} />
  }
}
