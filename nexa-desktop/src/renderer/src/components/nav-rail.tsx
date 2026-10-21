import { MessagesSquare, Package, Library, Clock, Settings } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { useSettingsOpen } from "@renderer/stores/ui-store"
import { LogoIcon } from "@renderer/components/logo-icon"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@renderer/components/ui/tooltip"

/** 导航栏宽度 */
export const NAV_RAIL_WIDTH = 78

/**
 * 左侧功能导航栏（78px 纯图标）:
 * 顶部 Logo + 功能导航图标 + 底部设置/用户
 */
export function NavRail() {
  const activeView = useSettingsOpen((s) => s.activeView)
  const setActiveView = useSettingsOpen((s) => s.setActiveView)
  const settingsOpen = useSettingsOpen((s) => s.settingsOpen)
  const setSettingsOpen = useSettingsOpen((s) => s.setSettingsOpen)

  return (
    <TooltipProvider delayDuration={0} skipDelayDuration={0}>
      <aside
        className="flex h-full shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar"
        style={{ width: `${NAV_RAIL_WIDTH}px` }}
      >
        {/* 顶部 Logo（自身为窗口拖动热区，替代 App.tsx 全局覆盖层，避免遮挡各页面顶栏点击） */}
        <div className="drag-bar flex w-full shrink-0 flex-col items-center justify-start" style={{ paddingTop: 48 }}>
          <LogoIcon className="h-8 w-8 shrink-0 text-sidebar-foreground" />
        </div>

        {/* 功能导航（图标间距 8px） */}
        <nav className="flex flex-col items-center gap-2 pt-4">
          <RailButton icon={MessagesSquare} label="任务" active={activeView === "chat"} onClick={() => setActiveView("chat")} />
          <RailButton icon={Clock} label="定时任务" active={activeView === "scheduled"} onClick={() => setActiveView("scheduled")} />
          <RailButton icon={Package} label="技能包" active={activeView === "skill-packs"} onClick={() => setActiveView("skill-packs")} />
          <RailButton icon={Library} label="资料库" active={activeView === "library"} onClick={() => setActiveView("library")} />
        </nav>

        <div className="flex-1" />

        {/* 底部: 设置 */}
        <RailButton icon={Settings} label="设置" active={settingsOpen} onClick={() => setSettingsOpen(true)} />
        <div className="mb-3" />
      </aside>
    </TooltipProvider>
  )
}

/** 导航栏图标按钮（hover 立即显示文字提示，使用 shadcn Tooltip 替代原生 title 的延迟气泡） */
function RailButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          aria-label={label}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            active
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          <Icon className="h-[22px] w-[22px]" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}
