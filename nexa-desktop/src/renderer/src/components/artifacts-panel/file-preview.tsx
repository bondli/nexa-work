import { File as FileIcon, FileCode2, Inbox, Loader2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { cn } from "@renderer/lib/utils"
import { MarkdownRenderer } from "@renderer/components/markdown-renderer"
import { useArtifactsStore } from "@renderer/stores/artifacts-store"
import { isHtmlFile, isMarkdownFile } from "./utils"

/**
 * 单文件内容预览：按类型分发
 * html → 内置浏览器（本地静态服务 iframe）；图片 → <img>；md → Markdown 渲染；其余 → 纯文本
 */

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

/** 文件预览区（按类型分发: HTML 内置浏览器 / 图片 / Markdown / 纯文本） */
export function FilePreview() {
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
