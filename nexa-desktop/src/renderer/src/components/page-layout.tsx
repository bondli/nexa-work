import type { ReactNode } from "react"

/** 统一左侧面板宽度（所有页面一致，对齐任务列表面板） */
export const LEFT_PANEL_WIDTH = 260

/**
 * 页面左侧面板（260px）:
 * 无标题行（拖动热区由 nav-rail 和 PageTitleBar 覆盖）
 */
export function LeftPanel({ children }: { children: ReactNode }) {
  return (
    <aside
      className="flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar"
      style={{ width: `${LEFT_PANEL_WIDTH}px` }}
    >
      {children}
    </aside>
  )
}

/** 面板头部图标按钮（搜索/筛选等，shadcn ghost 尺寸） */
export function PanelIconButton({
  icon: Icon,
  label,
  onClick,
  active,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick?: () => void
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring" +
        (active ? " bg-accent text-sidebar-foreground" : "")
      }
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}

/**
 * 右侧页面标题行（靠左对齐，整行可拖动窗口，内部控件自动豁免）;
 * 高度与左侧面板标题行一致（h-16），可选右侧操作区
 */
export function PageTitleBar({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="drag-bar flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
      <h1 className="text-sm font-semibold">{title}</h1>
      <div className="flex-1" />
      {actions}
    </div>
  )
}
