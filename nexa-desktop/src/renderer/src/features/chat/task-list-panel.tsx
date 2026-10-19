import { ChevronRight, ChevronDown, Plus, Folder, Loader2, CirclePause, CheckCircle2, XCircle, Trash2, MoreHorizontal, Pencil, Archive, ArchiveRestore, FolderOpen, Zap } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@renderer/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu"
import { cn } from "@renderer/lib/utils"
import { useSidebarStore } from "@renderer/stores/sidebar-store"
import { useConversationStore, type SessionItem } from "@renderer/stores/conversation-store"
import { useArtifactsStore } from "@renderer/stores/artifacts-store"
import { LeftPanel } from "@renderer/components/page-layout"

/**
 * 任务列表面板（chat 视图左侧分栏）:
 * 新建任务按钮 + 任务列表（free 扁平 + project 分组）
 */
export function TaskListPanel() {
  const fetchList = useConversationStore((s) => s.fetchList)

  // 挂载时拉列表（未归档 + 已归档合并）
  useEffect(() => {
    void fetchList()
  }, [fetchList])

  // 新建任务: 回到欢迎页（清空当前会话）并清空产物面板
  const startNewTask = () => {
    useConversationStore.setState({ currentSessionId: null })
    useArtifactsStore.getState().clear()
  }

  return (
    <LeftPanel>
      {/* 新建任务（外层容器 padding 16px） */}
      <div className="p-4">
        <Button className="h-8 w-full justify-center gap-1.5 text-sm" onClick={startNewTask}>
          <Plus className="h-4 w-4 shrink-0" /> 新建任务
        </Button>
      </div>

      {/* 任务列表（数据驱动） */}
      <div className="mt-1 flex-1 overflow-y-auto px-2 pb-2">
        <TaskList />
      </div>
    </LeftPanel>
  )
}

// ==========================================
// 任务列表（数据驱动 —— free 扁平 + project 分组）
// ==========================================
/** 项目分组 */
interface ProjectGroup {
  /** 项目路径（去尾斜杠） */
  path: string
  /** 项目名（basename） */
  name: string
  /** 该项目下的会话 */
  sessions: SessionItem[]
  /** 是否包含 running 会话 */
  hasRunning: boolean
}

function TaskList() {
  const sessionList = useConversationStore((s) => s.sessionList)
  const currentSessionId = useConversationStore((s) => s.currentSessionId)
  const selectSession = useConversationStore((s) => s.selectSession)
  const hiddenProjectPaths = useConversationStore((s) => s.hiddenProjectPaths)
  const expandedGroups = useSidebarStore((s) => s.expandedGroups)
  const setExpandedGroups = (next: Set<string>) => useSidebarStore.setState({ expandedGroups: next })
  const filterStatuses = useSidebarStore((s) => s.filterStatuses)

  /** 归档分组 key（与项目分组共用 expandedGroups 存储，默认不在集合中 = 收拢） */
  const ARCHIVED_GROUP_KEY = "__archived__"
  /** 自由任务分组 key（反转语义：不在集合中 = 展开，默认展开） */
  const FREE_GROUP_KEY = "__free__"
  const freeExpanded = !expandedGroups.has(FREE_GROUP_KEY)

  // 按状态过滤 + 软隐藏项目路径过滤
  const filtered = useMemo(() => {
    return sessionList.filter((s) => {
      // 状态过滤（空 = 显示全部）
      if (filterStatuses.size > 0 && !filterStatuses.has(s.status)) {
        return false
      }
      // 项目路径软隐藏（仅对 project 模式生效）
      if (s.mode === "project" && s.projectPath) {
        const p = s.projectPath.replace(/\/+$/, "")
        if (hiddenProjectPaths.includes(p)) return false
      }
      return true
    })
  }, [sessionList, filterStatuses, hiddenProjectPaths])

  // 分离 未归档 free / project / 已归档（列表自上而下：自由任务 → 编码任务 → 归档任务）
  const freeSessions = filtered.filter((s) => !s.archived && s.mode === "free")
  const projectSessions = filtered.filter((s) => !s.archived && s.mode === "project")
  const archivedSessions = filtered.filter((s) => s.archived)

  // project 按 projectPath 分组
  const groups: ProjectGroup[] = groupByProject(projectSessions)

  // 首次挂载：running 会话的 project 分组默认展开
  useEffect(() => {
    const current = new Set(useSidebarStore.getState().expandedGroups)
    let changed = false
    for (const g of groups) {
      if (g.hasRunning && !current.has(g.path)) { current.add(g.path); changed = true }
    }
    if (changed) setExpandedGroups(current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (sessionList.length === 0) {
    return <EmptyState />
  }

  return (
    <div className="flex flex-col gap-2">
      {/* 自由任务分组（与归档分组一致的交互样式，默认展开） */}
      {freeSessions.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <button
            onClick={() => {
              const current = new Set(useSidebarStore.getState().expandedGroups)
              if (current.has(FREE_GROUP_KEY)) current.delete(FREE_GROUP_KEY)
              else current.add(FREE_GROUP_KEY)
              useSidebarStore.setState({ expandedGroups: current })
            }}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {freeExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <Zap className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate text-sidebar-foreground">自由任务</span>
            <span className="text-[11px] text-muted-foreground/70">{freeSessions.length}</span>
          </button>
          {freeExpanded && freeSessions.map((s) => (
            <SessionRow key={s.id} item={s} active={currentSessionId === s.id} onClick={() => selectSession(s.id)} indent />
          ))}
        </div>
      )}

      {/* 项目分组 */}
      {groups.map((g) => {
        const isExpanded = expandedGroups.has(g.path) || g.hasRunning
        return (
          <div key={g.path} className="flex flex-col gap-0.5">
            <GroupHeader
              group={g}
              expanded={isExpanded}
              onToggle={() => {
                const current = new Set(useSidebarStore.getState().expandedGroups)
                if (current.has(g.path)) current.delete(g.path)
                else current.add(g.path)
                useSidebarStore.setState({ expandedGroups: current })
              }}
            />
            {isExpanded && g.sessions.map((s) => (
              <SessionRow key={s.id} item={s} active={currentSessionId === s.id} onClick={() => selectSession(s.id)} indent />
            ))}
          </div>
        )
      })}

      {/* 归档任务分组（默认收拢；会话只读，右侧不显示输入框） */}
      {archivedSessions.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <button
            onClick={() => {
              const current = new Set(useSidebarStore.getState().expandedGroups)
              if (current.has(ARCHIVED_GROUP_KEY)) current.delete(ARCHIVED_GROUP_KEY)
              else current.add(ARCHIVED_GROUP_KEY)
              useSidebarStore.setState({ expandedGroups: current })
            }}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {expandedGroups.has(ARCHIVED_GROUP_KEY) ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <Archive className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate text-sidebar-foreground">归档任务</span>
            <span className="text-[11px] text-muted-foreground/70">{archivedSessions.length}</span>
          </button>
          {expandedGroups.has(ARCHIVED_GROUP_KEY) && archivedSessions.map((s) => (
            <SessionRow key={s.id} item={s} active={currentSessionId === s.id} onClick={() => selectSession(s.id)} indent />
          ))}
        </div>
      )}
    </div>
  )
}

/** 按 projectPath 分组 */
function groupByProject(sessions: SessionItem[]): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>()
  for (const s of sessions) {
    const path = (s.projectPath ?? "未分类项目").replace(/\/$/, "")
    let group = map.get(path)
    if (!group) {
      const name = path === "未分类项目" ? path : path.split(/[\\/]/).pop() ?? path
      group = { path, name, sessions: [], hasRunning: false }
      map.set(path, group)
    }
    group.sessions.push(s)
    if (s.status === "running") group.hasRunning = true
  }
  // 按更新时间倒序
  return Array.from(map.values()).sort((a, b) => {
    const aLatest = Math.max(...a.sessions.map((s) => s.updatedAt))
    const bLatest = Math.max(...b.sessions.map((s) => s.updatedAt))
    return bLatest - aLatest
  })
}

// ===== 项目分组头部（hover 显示 "..." 菜单） =====
function GroupHeader({ group, expanded, onToggle }: { group: ProjectGroup; expanded: boolean; onToggle: () => void }) {
  const setPendingProjectPath = useConversationStore((s) => s.setPendingProjectPath)
  const hideProject = useConversationStore((s) => s.hideProject)

  const startNewTaskInGroup = () => {
    // 清当前会话 + 清产物面板（与顶层「新建任务」按钮保持一致）+ 注入 pendingProjectPath
    useArtifactsStore.getState().clear()
    setPendingProjectPath(group.path)
    useConversationStore.setState({ currentSessionId: null })
  }

  const openGroupFolder = () => {
    if (typeof window !== "undefined" && window.nexa?.openFolder) {
      void window.nexa.openFolder(group.path)
    }
  }

  const hideGroupFromList = () => {
    void hideProject(group.path)
  }

  const menuActionClass = "gap-2 [&_svg]:text-muted-foreground"

  return (
    <div
      // 命名空间 group/gh 避免与 SessionRow 的 group 冲突
      className="group/gh flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-sm hover:bg-accent"
    >
      {/* 左侧主区域（点击展开/收拢） */}
      <button
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-sidebar-foreground">{group.name}</span>
        {group.hasRunning && (
          <span className="flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            运行中
          </span>
        )}
      </button>

      {/* 右侧：先 hover 显示 "..." 菜单，再数字（顺序对齐 WorkBuddy） */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="分组操作"
            title="更多操作"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/gh:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem className={menuActionClass} onClick={startNewTaskInGroup}>
            <Plus /> 新建任务
          </DropdownMenuItem>
          <DropdownMenuItem className={menuActionClass} onClick={openGroupFolder}>
            <FolderOpen /> 打开文件夹
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 text-destructive focus:text-destructive [&_svg]:text-destructive"
            onClick={hideGroupFromList}
          >
            <Trash2 /> 从列表中移除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="shrink-0 text-[11px] text-muted-foreground/70">{group.sessions.length}</span>
    </div>
  )
}

// ===== 会话行 =====
function SessionRow({
  item,
  active,
  onClick,
  indent,
}: {
  item: SessionItem
  active: boolean
  onClick: () => void
  indent?: boolean
}) {
  const deleteSession = useConversationStore((s) => s.deleteSession)
  const renameSession = useConversationStore((s) => s.renameSession)
  const archiveSession = useConversationStore((s) => s.archiveSession)
  const revealSession = useConversationStore((s) => s.revealSession)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.title)
  const inputRef = useRef<HTMLInputElement>(null)
  /** 重命名点击标记: 阻止 Radix 菜单关闭时把焦点还原到触发按钮（与行内输入框抢焦点） */
  const renamePendingRef = useRef(false)
  /** 输入框完成聚焦前忽略 blur（Radix 卸载清理可能引发竞争 blur 触发误提交） */
  const focusedRef = useRef(false)

  useEffect(() => {
    if (editing) {
      setDraft(item.title)
      focusedRef.current = false
      // 等输入框挂载后聚焦并全选
      const raf = requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
        focusedRef.current = true
      })
      return () => cancelAnimationFrame(raf)
    }
  }, [editing, item.title])

  const commitRename = () => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== item.title) void renameSession(item.id, next)
  }

  const startRename = () => {
    renamePendingRef.current = true
    setEditing(true)
  }

  const menuActionClass = "gap-2 [&_svg]:text-muted-foreground"

  return (
    <div
      className={cn(
        "group flex w-full items-center rounded-md pr-1 transition-colors",
        active ? "bg-accent" : "hover:bg-accent/60"
      )}
      style={indent ? { paddingLeft: "calc(0.5rem + 0.75rem)" } : undefined}
    >
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename()
            if (e.key === "Escape") setEditing(false)
          }}
          onBlur={() => {
            // 挂载初期 Radix 焦点清理可能引发 blur，完成聚焦前忽略
            if (!focusedRef.current) return
            commitRename()
          }}
          className="mx-1 h-6 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <button
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <StatusBadge status={item.status} />
          <span className="flex-1 truncate text-sm text-sidebar-foreground">{item.title}</span>
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="任务操作"
            title="更多操作"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-40"
          onCloseAutoFocus={(e) => {
            // 重命名时禁止 Radix 把焦点还原到触发按钮，让行内输入框拿到焦点
            if (renamePendingRef.current) {
              e.preventDefault()
              renamePendingRef.current = false
            }
          }}
        >
          <DropdownMenuItem className={menuActionClass} onClick={startRename}>
            <Pencil /> 重命名
          </DropdownMenuItem>
          <DropdownMenuItem className={menuActionClass} onClick={() => void revealSession(item.id)}>
            <FolderOpen /> 打开文件夹
          </DropdownMenuItem>
          <DropdownMenuItem
            className={menuActionClass}
            disabled={item.status === "running"}
            title={item.status === "running" ? "运行中的会话不能归档" : undefined}
            onClick={() => void archiveSession(item.id, !item.archived)}
          >
            {item.archived ? <ArchiveRestore /> : <Archive />}
            {item.archived ? "取消归档" : "归档"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 text-destructive focus:text-destructive [&_svg]:text-destructive"
            onClick={() => void deleteSession(item.id)}
          >
            <Trash2 /> 删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ===== 状态徽章 =====
function StatusBadge({ status }: { status: SessionItem["status"] }) {
  const iconMap = {
    running: Loader2,
    paused: CirclePause,
    completed: CheckCircle2,
    failed: XCircle,
  } as const
  const Icon = iconMap[status]
  const colorMap = {
    running: "text-primary",
    paused: "text-muted-foreground",
    completed: "text-emerald-500",
    failed: "text-red-500",
  } as const
  return (
    <Icon
      className={cn("h-3.5 w-3.5 shrink-0", colorMap[status], status === "running" && "animate-spin")}
    />
  )
}

// ===== 空状态 =====
function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
      <p className="text-sm text-muted-foreground">暂无任务</p>
      <p className="text-xs text-muted-foreground/70">创建一个新任务开始</p>
    </div>
  )
}
