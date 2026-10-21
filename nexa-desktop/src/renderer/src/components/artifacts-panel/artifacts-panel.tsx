import { Folder, Inbox, Loader2, Maximize2, Minimize2, PanelRightClose, PanelRightOpen } from "lucide-react"
import { useMemo } from "react"
import { cn } from "@renderer/lib/utils"
import { useArtifactsStore } from "@renderer/stores/artifacts-store"
import { FilePreview } from "./file-preview"
import { TreeNode } from "./tree-node"
import { FileIconFor, countWorkspaceFiles, formatSize } from "./utils"

export { countWorkspaceFiles, FileIconFor } from "./utils"

/**
 * ArtifactsPanel - 通用文档渲染面板（右侧全高抽屉，全局挂载）
 *
 * 职责：渲染文档内容。两种形态：
 * - 单文件纯渲染（previewOnly）：资料库「文档」、消息文件卡等入口点开即看，无文件树
 * - 带文件树浏览：任务会话产物，左侧预览 + 右侧文件树点击选择具体文件
 */

/** 当前文件信息行（图标 + 路径 + 大小，两种形态共用） */
function CurrentFileBar() {
  const selectedPath = useArtifactsStore((s) => s.selectedPath)
  const readResult = useArtifactsStore((s) => s.readResult)
  if (!selectedPath) return null
  return (
    <div className="flex h-8 shrink-0 items-center gap-1.5 border-b px-3 text-xs text-muted-foreground">
      <FileIconFor name={selectedPath} />
      <span className="truncate">{selectedPath}</span>
      {readResult?.size != null && <span className="ml-auto shrink-0">{formatSize(readResult.size)}</span>}
    </div>
  )
}

/** 形态一：单个文件纯渲染（无文件树，点开即看） */
function SingleFilePreview() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <CurrentFileBar />
      <FilePreview />
    </div>
  )
}

/** 形态二：带文件树的浏览渲染（左侧预览 + 右侧文件树点击选择具体文件） */
function WorkspaceFileBrowser() {
  const loading = useArtifactsStore((s) => s.loading)
  const tree = useArtifactsStore((s) => s.tree)
  return (
    <div className="flex min-h-0 flex-1">
      {/* 左侧: 预览区 */}
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <CurrentFileBar />
        <FilePreview />
      </div>
      {/* 右侧: 文件树（贴边） */}
      <div className="flex w-[240px] shrink-0 flex-col border-l">
        <div className="flex h-8 shrink-0 items-center gap-1.5 border-b px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          文件
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {loading && tree.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : tree.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
              <Inbox className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-[11px] text-muted-foreground">工作目录还没有文件</p>
            </div>
          ) : (
            tree.map((n) => <TreeNode key={n.path} node={n} depth={0} />)
          )}
        </div>
      </div>
    </div>
  )
}

export function ArtifactsPanel() {
  const panelOpen = useArtifactsStore((s) => s.panelOpen)
  const setPanelOpen = useArtifactsStore((s) => s.setPanelOpen)
  const maximized = useArtifactsStore((s) => s.maximized)
  const toggleMaximized = useArtifactsStore((s) => s.toggleMaximized)
  const previewOnly = useArtifactsStore((s) => s.previewOnly)
  const setPreviewOnly = useArtifactsStore((s) => s.setPreviewOnly)
  const tree = useArtifactsStore((s) => s.tree)
  const sessionId = useArtifactsStore((s) => s.sessionId)

  const fileCount = useMemo(() => countWorkspaceFiles(tree), [tree])

  return (
    <>
      {/* 遮罩（开启时淡入，点击关闭；no-drag 防止底层顶栏拖动区穿透） */}
      {panelOpen && (
        <div className="no-drag fixed inset-0 z-40 animate-in fade-in-0 duration-200" onClick={() => setPanelOpen(false)} />
      )}

      {/* 抽屉本体（常驻挂载，transform/width 滑入滑出；右侧贴边、上下铺满；最大化时延展到左侧导航栏旁）
          no-drag 必须显式声明：Electron 拖动区域不理会 z-index，顶栏 .drag-bar 会穿透抽屉吞掉头部按钮点击 */}
      <aside
        aria-label="产物面板"
        aria-hidden={!panelOpen}
        className={cn(
          "no-drag fixed inset-y-0 right-0 z-50 flex flex-col border-l border-border bg-sidebar shadow-2xl transition-all duration-200 ease-out",
          panelOpen ? "translate-x-0" : "translate-x-full",
          maximized ? "w-[calc(100vw-78px)]" : "w-[600px] max-w-[85vw]"
        )}
      >
        {/* 头部: 标题/返回文件树左，文件数 / 最大化 / 收起右（按钮 32px 命中区） */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <div className="flex min-w-0 items-center gap-2">
            {previewOnly && (
              <button
                onClick={() => setPreviewOnly(false)}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                title="显示文件列表"
                aria-label="显示文件列表"
              >
                <PanelRightOpen className="h-4 w-4" />
              </button>
            )}
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{previewOnly ? "文件预览" : "产物文件"}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {fileCount > 0 && !previewOnly && (
              <span className="mr-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{fileCount} 个文件</span>
            )}
            <button
              onClick={toggleMaximized}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              title={maximized ? "还原面板宽度" : "铺满整个任务页"}
              aria-label={maximized ? "还原面板宽度" : "铺满整个任务页"}
            >
              {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setPanelOpen(false)}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              title="收起"
              aria-label="收起产物面板"
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 主体: 仅预览模式整宽显示内容；完整模式为左预览 + 右文件树 */}
        {!sessionId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">选择会话后，这里展示 Agent 产出的文件</p>
          </div>
        ) : previewOnly ? (
          <SingleFilePreview />
        ) : (
          <WorkspaceFileBrowser />
        )}
      </aside>
    </>
  )
}
