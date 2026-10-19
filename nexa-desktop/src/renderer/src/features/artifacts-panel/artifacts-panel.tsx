import { useEffect, useMemo, useRef, useState } from "react"
import {
  PanelRightClose,
  PanelRightOpen,
  Folder,
  FolderOpen,
  FileText,
  FileCode2,
  FileJson,
  FileImage,
  File as FileIcon,
  Maximize2,
  Minimize2,
  Inbox,
  Loader2,
} from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { useArtifactsStore } from "@renderer/stores/artifacts-store"
import type { WorkspaceFileNode } from "@shared/ipc-channels"
import { MarkdownRenderer } from "@renderer/components/markdown-renderer"

/** 按扩展名挑文件图标（产物面板与消息内文件卡共用） */
export function FileIconFor({ name, className }: { name: string; className?: string }) {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase()
  const iconCls = className ?? "h-3.5 w-3.5 text-muted-foreground shrink-0"
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) return <FileImage className={iconCls} />
  if (["json", "yaml", "yml", "toml"].includes(ext)) return <FileJson className={iconCls} />
  if (["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "cpp", "sh", "bash"].includes(ext)) return <FileCode2 className={iconCls} />
  if (["md", "txt", "pdf"].includes(ext)) return <FileText className={iconCls} />
  return <FileIcon className={iconCls} />
}

/** HTML / HTM 文件走内置浏览器（iframe）预览 */
function isHtmlFile(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith(".html") || lower.endsWith(".htm")
}

/** Markdown 文件: 直接渲染预览（兼容 .md / .markdown） */
function isMarkdownFile(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith(".md") || lower.endsWith(".markdown")
}

/**
 * 内置浏览器预览（HTML）: 主进程本地静态服务（http://127.0.0.1:<port>/artifact/<sessionId>/<path>）
 * 纯 http iframe 加载，相对路径的 css/js/图片等资源正常解析；3s 未加载完成回退源码视图
 */
function HtmlPreview({ sessionId, path }: { sessionId: string; path: string }) {
  const previewBase = useArtifactsStore((s) => s.previewBase)
  const ensurePreviewBase = useArtifactsStore((s) => s.ensurePreviewBase)
  const readResult = useArtifactsStore((s) => s.readResult)
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading")
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const src = previewBase
    ? `${previewBase}/artifact/${sessionId}/${path.split("/").map(encodeURIComponent).join("/")}`
    : null

  // 懒获取预览服务地址 + src 变化时重置状态、启动加载超时计时
  useEffect(() => {
    if (!previewBase) void ensurePreviewBase()
    setStatus("loading")
    if (!src) return
    timerRef.current = setTimeout(() => {
      setStatus((s) => (s === "loading" ? "error" : s))
    }, 3000)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [src, previewBase, ensurePreviewBase])

  const onLoad = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setStatus("loaded")
  }

  return (
    <div className="relative min-h-0 flex-1">
      {src && status !== "error" && (
        <iframe
          key={src}
          src={src}
          title={path}
          onLoad={onLoad}
          className={cn("h-full w-full border-0 bg-white", status === "loading" && "invisible")}
        />
      )}
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-background">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-auto bg-background p-6 text-center">
          <FileCode2 className="h-8 w-8 shrink-0 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">内置浏览器加载失败（预览服务未就绪或文件不存在）</p>
          {readResult?.content != null ? (
            <pre className="max-h-[60%] w-full overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-left font-mono text-xs text-foreground/90">{readResult.content}</pre>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** 单个文件树节点（递归） */
function TreeNode({ node, depth }: { node: WorkspaceFileNode; depth: number }) {
  const expanded = useArtifactsStore((s) => s.expanded)
  const selectedPath = useArtifactsStore((s) => s.selectedPath)
  const toggleDir = useArtifactsStore((s) => s.toggleDir)
  const selectFile = useArtifactsStore((s) => s.selectFile)
  const isOpen = expanded.has(node.path)

  if (node.type === "directory") {
    return (
      <div>
        <button
          onClick={() => toggleDir(node.path)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          {isOpen ? <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          <span className="truncate text-sidebar-foreground">{node.name}</span>
        </button>
        {isOpen && node.children?.map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} />)}
      </div>
    )
  }

  const isSelected = selectedPath === node.path
  return (
    <button
      onClick={() => void selectFile(node.path)}
      className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${
        isSelected ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground"
      }`}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      title={`${node.path}${node.size != null ? ` (${formatSize(node.size)})` : ""}`}
    >
      <FileIconFor name={node.name} />
      <span className="truncate">{node.name}</span>
    </button>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 文件预览区（左侧，按类型分发: HTML 内置浏览器 / 图片 / Markdown / 纯文本） */
function FilePreview() {
  const selectedPath = useArtifactsStore((s) => s.selectedPath)
  const readResult = useArtifactsStore((s) => s.readResult)
  const sessionId = useArtifactsStore((s) => s.sessionId)

  if (!selectedPath) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
        <Inbox className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">点击右侧文件查看内容</p>
      </div>
    )
  }
  // HTML 走内置浏览器: 无需等文本读取，iframe 直接经协议加载（超大 HTML 也可预览）
  if (sessionId && isHtmlFile(selectedPath)) {
    return <HtmlPreview sessionId={sessionId} path={selectedPath} />
  }
  if (!readResult) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (readResult.isImage && readResult.dataUrl) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-auto p-3">
        <img src={readResult.dataUrl} alt={selectedPath} className="max-h-full max-w-full rounded-md border" />
      </div>
    )
  }
  if (readResult.content == null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
        <FileIcon className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">文件过大或为二进制格式，暂不支持预览</p>
      </div>
    )
  }
  // Markdown 渲染，其他文本 pre 展示
  return (
    <div className="flex-1 overflow-y-auto p-3">
      {isMarkdownFile(selectedPath) ? (
        <MarkdownRenderer content={readResult.content} />
      ) : (
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/90">{readResult.content}</pre>
      )}
    </div>
  )
}

/** 递归统计文件树中的文件数（供顶栏产物按钮徽标使用） */
export function countWorkspaceFiles(nodes: WorkspaceFileNode[]): number {
  let n = 0
  const walk = (list: WorkspaceFileNode[]) => {
    for (const nd of list) {
      if (nd.type === "file") n++
      else if (nd.children) walk(nd.children)
    }
  }
  walk(nodes)
  return n
}

/**
 * 产物面板（右侧全高抽屉）:
 * 顶栏图标点击 → 从右侧贴边滑出，上下铺满窗口；左预览 + 右文件树，文件数徽标在头部右侧
 */
export function ArtifactsPanel() {
  const panelOpen = useArtifactsStore((s) => s.panelOpen)
  const setPanelOpen = useArtifactsStore((s) => s.setPanelOpen)
  const maximized = useArtifactsStore((s) => s.maximized)
  const toggleMaximized = useArtifactsStore((s) => s.toggleMaximized)
  const previewOnly = useArtifactsStore((s) => s.previewOnly)
  const setPreviewOnly = useArtifactsStore((s) => s.setPreviewOnly)
  const tree = useArtifactsStore((s) => s.tree)
  const loading = useArtifactsStore((s) => s.loading)
  const sessionId = useArtifactsStore((s) => s.sessionId)
  const selectedPath = useArtifactsStore((s) => s.selectedPath)
  const readResult = useArtifactsStore((s) => s.readResult)

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
          <div className="flex min-h-0 flex-1 flex-col bg-background">
            {selectedPath && (
              <div className="flex h-8 shrink-0 items-center gap-1.5 border-b px-3 text-xs text-muted-foreground">
                <FileIconFor name={selectedPath} />
                <span className="truncate">{selectedPath}</span>
                {readResult?.size != null && <span className="ml-auto shrink-0">{formatSize(readResult.size)}</span>}
              </div>
            )}
            <FilePreview />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* 左侧: 预览区 */}
            <div className="flex min-w-0 flex-1 flex-col bg-background">
              {selectedPath && (
                <div className="flex h-8 shrink-0 items-center gap-1.5 border-b px-3 text-xs text-muted-foreground">
                  <FileIconFor name={selectedPath} />
                  <span className="truncate">{selectedPath}</span>
                  {readResult?.size != null && <span className="ml-auto shrink-0">{formatSize(readResult.size)}</span>}
                </div>
              )}
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
        )}
      </aside>
    </>
  )
}
