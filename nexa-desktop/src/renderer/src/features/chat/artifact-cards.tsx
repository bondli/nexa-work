/**
 * 会话内产物文件卡 —— 内联在最后一条 assistant 消息的正文之后（不再单独占一行）
 * 点击卡片: 打开右侧产物面板 → 展开父目录 → 选中预览（openArtifact）
 */
import { useEffect, useMemo } from "react"
import { useArtifactsStore } from "@renderer/stores/artifacts-store"
import { FileIconFor } from "@renderer/features/artifacts-panel/artifacts-panel"
import type { WorkspaceFileNode } from "@shared/ipc-channels"

/** 视为「最终产物」的文档类扩展名 */
const DOC_EXTS = ["md", "html", "htm", "pdf", "docx", "xlsx", "pptx", "csv", "txt"]

/** 最多展示的卡片数（避免大工作目录刷屏） */
const MAX_CARDS = 8

function collectDocFiles(nodes: WorkspaceFileNode[], out: WorkspaceFileNode[] = []): WorkspaceFileNode[] {
  for (const n of nodes) {
    if (n.type === "file") {
      const ext = n.name.slice(n.name.lastIndexOf(".") + 1).toLowerCase()
      if (DOC_EXTS.includes(ext)) out.push(n)
    } else if (n.children) {
      collectDocFiles(n.children, out)
    }
  }
  return out
}

/** 文件大小展示：B / KB / MB */
function formatSize(bytes: number | undefined): string | null {
  if (bytes === undefined) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ArtifactCards({ sessionId }: { sessionId: string }) {
  const tree = useArtifactsStore((s) => s.tree)
  const fetchTree = useArtifactsStore((s) => s.fetchTree)
  const openArtifact = useArtifactsStore((s) => s.openArtifact)

  // 挂载即拉取文件树（面板未展开也拉，供卡片列表展示）
  useEffect(() => {
    void fetchTree(sessionId)
  }, [sessionId, fetchTree])

  const docs = useMemo(() => collectDocFiles(tree).slice(0, MAX_CARDS), [tree])
  if (docs.length === 0) return null

  return (
    // 多个文件两列排布；只有一个文件时单列通栏
    <div className={docs.length > 1 ? "mt-2 grid grid-cols-2 gap-2" : "mt-2 grid grid-cols-1 gap-2"}>
      {docs.map((f) => {
        const size = formatSize(f.size)
        return (
          <div
            key={f.path}
            role="button"
            tabIndex={0}
            onClick={() => void openArtifact(sessionId, f.path)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                void openArtifact(sessionId, f.path)
              }
            }}
            title={f.path}
            className="flex cursor-pointer items-center gap-2.5 rounded-xl bg-muted px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FileIconFor name={f.name} className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{f.name}</p>
              <p className="truncate text-[10px] text-muted-foreground">{size ?? f.path}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
