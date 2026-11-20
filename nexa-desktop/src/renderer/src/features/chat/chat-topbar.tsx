/** 会话顶栏（从 chat-shell 迁入）：标题 / 状态点 / 暂停继续重试 / 产物面板入口 */
import { useMemo } from "react"
import { Pause, Play, RotateCcw, FolderOpen, Archive } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { cn } from "@renderer/lib/utils"
import { shortenPath } from "./lib/format"
import { useArtifactsStore } from "@renderer/stores/artifacts-store"
import { countWorkspaceFiles } from "@renderer/components/artifacts-panel/artifacts-panel"
import type { Conversation } from "@renderer/stores/conversation-store"

/** 顶栏右上角产物入口按钮: 图标 + 文件数徽标，点击唤出产物浮窗（无文件时点击拉取目录） */
function TopbarArtifactsButton({ sessionId }: { sessionId: string }) {
  const panelOpen = useArtifactsStore((s) => s.panelOpen)
  const setPanelOpen = useArtifactsStore((s) => s.setPanelOpen)
  const setPreviewOnly = useArtifactsStore((s) => s.setPreviewOnly)
  const tree = useArtifactsStore((s) => s.tree)
  const fetchTree = useArtifactsStore((s) => s.fetchTree)
  const fileCount = useMemo(() => countWorkspaceFiles(tree), [tree])

  return (
    <button
      onClick={() => {
        // 顶栏入口始终打开完整模式（文件树 + 预览），退出仅预览态
        setPreviewOnly(false)
        if (!panelOpen && tree.length === 0) void fetchTree(sessionId)
        setPanelOpen(!panelOpen)
      }}
      className={cn(
        "no-drag relative flex h-7 w-7 items-center justify-center rounded-md outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        panelOpen ? "bg-accent text-foreground" : "text-muted-foreground"
      )}
      title="产物文件"
      aria-label="产物文件"
    >
      <FolderOpen className="h-4 w-4" />
      {fileCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
          {fileCount > 99 ? "99+" : fileCount}
        </span>
      )}
    </button>
  )
}

export function ChatTopbar({
  conv,
  isRunning,
  isPaused,
  isFailed,
  isArchived,
  canRetry,
  onPause,
  onResume,
  onRetry,
}: {
  conv: Conversation
  isRunning: boolean
  isPaused: boolean
  isFailed: boolean
  isArchived: boolean
  canRetry: boolean
  onPause: () => void
  onResume: () => void
  onRetry: () => void
}) {
  const statusColor = {
    running: "bg-primary",
    paused: "bg-muted-foreground",
    completed: "bg-emerald-500",
    failed: "bg-red-500",
  }[conv.status]
  const statusLabel = {
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
  }[conv.status]

  return (
    <div className="flex h-16 items-center gap-3 border-b border-border px-6">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", statusColor, conv.status === "running" && "animate-pulse")} />
        <span className="truncate text-sm font-medium">{conv.title}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {conv.mode === "free" ? "自由" : "项目"}
        </span>
        {conv.mode === "project" && conv.projectPath && (
          <span className="max-w-[180px] truncate text-[10px] text-muted-foreground" title={conv.projectPath}>
            {shortenPath(conv.projectPath)}
          </span>
        )}
        <span className="text-xs text-muted-foreground">{statusLabel}</span>
        {isArchived && (
          <span className="flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <Archive className="h-3 w-3" />
            已归档
          </span>
        )}
      </div>
      <div className="flex-1" />
      {/* 会话控制（从底部输入区移入顶栏；删除入口保留在侧栏任务行菜单） */}
      {isRunning && !isArchived && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onPause}
          aria-label="暂停"
          title="暂停"
          className="no-drag h-7 w-7 text-muted-foreground"
        >
          <Pause className="h-4 w-4" />
        </Button>
      )}
      {isPaused && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onResume}
          aria-label="继续"
          title="继续"
          className="no-drag h-7 w-7 text-muted-foreground"
        >
          <Play className="h-4 w-4" />
        </Button>
      )}
      {isFailed && canRetry && !isArchived && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onRetry}
          aria-label="重试"
          title="重发最后一条消息"
          className="no-drag h-7 w-7 text-muted-foreground"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      )}
      {/* 产物面板入口；顶栏 drag，控件需 no-drag */}
      <TopbarArtifactsButton sessionId={conv.id} />
    </div>
  )
}
