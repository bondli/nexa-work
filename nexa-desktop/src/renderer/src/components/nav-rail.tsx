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
        // 底色对齐 nova：浅色 muted（灰底）压在白底内容上，深色用 background（最暗）压浅一档的面板，
        // 避免与右侧页面/面板同色导致边界糊在一起
        className="flex h-full shrink-0 flex-col items-center border-r border-border bg-muted dark:bg-background"
        style={{ width: `${NAV_RAIL_WIDTH}px` }}
      >
        {/* 顶部 Logo（自身为窗口拖动热区，替代 App.tsx 全局覆盖层，避免遮挡各页面顶栏点击） */}
        <div className="drag-bar flex w-full shrink-0 flex-col items-center justify-start" style={{ paddingTop: 48 }}>
          <LogoIcon className="h-8 w-8 shrink-0 text-primary" />
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
            // 选中态对齐 nova：淡品牌底 + 品牌色图标（nova 的 RailItem 即 bg-accent text-primary）
            active
              ? "bg-accent text-primary"
              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          )}
        >
          <Icon className="h-[22px] w-[22px]" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}
