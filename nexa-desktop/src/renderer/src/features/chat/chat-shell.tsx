/**
 * ChatShell：聊天视图的薄壳，仅负责
 *  1) 取当前会话 → 渲染 WelcomeView 或 ConversationView
 *  2) ConversationView 内完成发送/暂停/重试的状态接线与布局组装
 * 消息渲染、滚动、折叠、任务清单、minimap 等全部下沉到 ./transcript/* 与 ./composer/*。
 */
import { useEffect, useMemo, useState } from "react"
import { Archive } from "lucide-react"
import { useConversationStore, type Conversation } from "@renderer/stores/conversation-store"
import type { AttachmentInput } from "@shared/ipc-channels"
import { buildTurns } from "./lib/build-turns"
import { ChatTranscript } from "./transcript/chat-transcript"
import { TodoDock } from "./transcript/todo-dock"
import { ChatTopbar } from "./chat-topbar"
import { WelcomeView } from "./welcome-view"
import { InputBar } from "./composer/input-bar"

export function ChatShell() {
  const currentSessionId = useConversationStore((s) => s.currentSessionId)
  const sessions = useConversationStore((s) => s.sessions)
  const conv = currentSessionId ? sessions[currentSessionId] : null
  return conv ? <ConversationView conv={conv} /> : <WelcomeView />
}

function ConversationView({ conv }: { conv: Conversation }) {
  const sendMessage = useConversationStore((s) => s.sendMessage)
  const pauseSession = useConversationStore((s) => s.pauseSession)
  const resumeSession = useConversationStore((s) => s.resumeSession)
  const selectSession = useConversationStore((s) => s.selectSession)
  /** 已归档会话只读: 隐藏底部输入框，禁止继续对话 */
  const isArchived = useConversationStore((s) => s.sessionList.find((x) => x.id === conv.id)?.archived ?? false)

  const [input, setInput] = useState("")
  const [sendError, setSendError] = useState<string | null>(null)

  // 扁平消息 → 以「轮」为单位的视图数据（消息渲染的唯一数据入口）
  const turns = useMemo(() => buildTurns(conv.messages, conv.runs ?? {}), [conv.messages, conv.runs])

  // 切换会话时加载历史
  useEffect(() => {
    if (conv.id && conv.messages.length === 0) void selectSession(conv.id)
  }, [conv.id, conv.messages.length, selectSession])

  const isRunning = conv.status === "running"
  const isPaused = conv.status === "paused"
  const isFailed = conv.status === "failed"
  /** 最后一条 user 消息，失败重试时重发 */
  const lastUserMessage = [...conv.messages].reverse().find((m) => m.role === "user")

  const handleSend = async (finalText: string, opts: { expertId?: string; attachments?: AttachmentInput[] }): Promise<boolean> => {
    if ((!finalText.trim() && !opts.attachments?.length) || isRunning || isArchived) return false
    setSendError(null)
    // 附加了专家: 与当前不同则先切换（下一轮生效）
    if (opts.expertId && opts.expertId !== conv.currentExpert) {
      await window.nexa.sessionSetExpert({ sessionId: conv.id, expertId: opts.expertId })
    }
    const ok = await sendMessage(conv.id, finalText.trim(), opts.attachments)
    if (ok) setInput("")
    else setSendError("发送失败：会话不可用或正在运行")
    return ok
  }

  /** 失败重试：重发最后一条 user 消息 */
  const handleRetry = async () => {
    if (isRunning || isArchived || !lastUserMessage) return
    setSendError(null)
    const ok = await sendMessage(conv.id, lastUserMessage.content)
    if (!ok) setSendError("重试失败：会话不可用或正在运行")
  }

  return (
    <main className="flex h-full flex-1 flex-col bg-card">
      {/* 顶栏（自身可拖动窗口，内部控件以 no-drag 豁免） */}
      <div className="drag-bar shrink-0">
        <ChatTopbar
          conv={conv}
          isRunning={isRunning}
          isPaused={isPaused}
          isFailed={isFailed}
          isArchived={isArchived}
          canRetry={Boolean(lastUserMessage)}
          onPause={() => void pauseSession(conv.id)}
          onResume={() => void resumeSession(conv.id)}
          onRetry={() => void handleRetry()}
        />
      </div>

      {/* 消息区（滚动 / minimap / 状态条 / 回到底部 全部封装在 ChatTranscript 内） */}
      <ChatTranscript sessionId={conv.id} turns={turns} />

      {/* 底部输入区：悬浮任务清单 + 输入框；归档会话只给只读提示 */}
      {isArchived ? (
        <div className="flex h-[68px] shrink-0 items-center justify-center border-t border-border px-6">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Archive className="h-3.5 w-3.5" />
            会话已归档，仅可查看历史消息（任务列表中可取消归档）
          </p>
        </div>
      ) : (
        <div className="shrink-0 border-t border-border px-6 py-3">
          <div className="mx-auto w-full max-w-4xl space-y-2">
            <TodoDock turns={turns} />
            <InputBar
              value={input}
              onChange={setInput}
              onSend={handleSend}
              loading={isRunning}
              placeholder={isRunning ? "Agent 执行中..." : "继续对话..."}
              currentExpertId={conv.currentExpert}
              model={conv.model}
              sessionId={conv.id}
            />
            {sendError && <p className="text-xs text-red-500">{sendError}</p>}
          </div>
        </div>
      )}
    </main>
  )
}
