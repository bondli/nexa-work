import { File as FileIcon, FileCode2, FileImage, FileJson, FileText } from "lucide-react"
import type { WorkspaceFileNode } from "@shared/ipc-channels"

/**
 * ArtifactsPanel 纯工具：文件图标 / 类型判断 / 统计与格式化
 */

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
export function isHtmlFile(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith(".html") || lower.endsWith(".htm")
}

/** Markdown 文件: 直接渲染预览（兼容 .md / .markdown） */
export function isMarkdownFile(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith(".md") || lower.endsWith(".markdown")
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
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
