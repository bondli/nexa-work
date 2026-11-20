/** 用户消息气泡（含附件缩略图 + 复制），从 chat-shell 迁入并收敛样式 */
import { useEffect, useState } from "react"
import type { ChatAttachment } from "@shared/ipc-channels"
import type { ChatMessage } from "@renderer/stores/conversation-store"
import { formatMessageTime } from "@renderer/lib/utils"
import { CopyButton } from "./message-actions"

export function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="group max-w-[80%]">
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
            {message.attachments.map((att) => (
              <AttachmentThumb key={att.path} att={att} />
            ))}
          </div>
        )}
        {message.content && (
          <div className="rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          </div>
        )}
        <div className="mt-1 flex items-center justify-end gap-2 opacity-0 transition group-hover:opacity-100">
          <span className="text-[11px] text-muted-foreground/70">{formatMessageTime(message.createdAt)}</span>
          <CopyButton text={message.content} />
        </div>
      </div>
    </div>
  )
}

/** 用户消息附件缩略图（经 IPC 读取 ~/.nexa/uploads 内文件为 dataURL） */
function AttachmentThumb({ att }: { att: ChatAttachment }) {
  const [dataUrl, setDataUrl] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    void window.nexa
      .attachmentRead(att.path)
      .then((d: unknown) => {
        if (alive) setDataUrl((d as string | null) ?? null)
      })
      .catch(() => {
        if (alive) setDataUrl(null)
      })
    return () => {
      alive = false
    }
  }, [att.path])

  if (dataUrl) {
    return (
      <img
        src={dataUrl}
        alt={att.name}
        title={`${att.name}\n${att.path}`}
        className="h-24 w-24 rounded-lg border border-border object-cover"
      />
    )
  }
  return (
    <div
      title={att.path}
      className="flex h-24 w-24 items-center justify-center rounded-lg border border-border bg-muted px-1 text-center text-[10px] leading-tight text-muted-foreground"
    >
      {dataUrl === undefined ? "加载中…" : "图片不可用"}
    </div>
  )
}
