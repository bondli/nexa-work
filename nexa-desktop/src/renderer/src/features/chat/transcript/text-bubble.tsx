/** 过程中的中间 assistant 文本（非最终回答），走 markdown 渲染 */
import { TranscriptProse } from "./transcript-prose"

export function TextBubble({ message }: { message: { id: string; content: string; streaming?: boolean } }) {
  return (
    <div className="text-foreground">
      <TranscriptProse content={message.content} streaming={message.streaming} />
    </div>
  )
}
