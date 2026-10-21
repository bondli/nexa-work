import { Folder, FolderOpen } from "lucide-react"
import type { WorkspaceFileNode } from "@shared/ipc-channels"
import { useArtifactsStore } from "@renderer/stores/artifacts-store"
import { FileIconFor, formatSize } from "./utils"

/** 单个文件树节点（递归，目录可展开/收起，文件点击即选） */
export function TreeNode({ node, depth }: { node: WorkspaceFileNode; depth: number }) {
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
