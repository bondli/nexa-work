import { useState, useEffect } from "react"
import { NavRail } from "@renderer/features/sidebar/nav-rail"
import { TaskListPanel } from "@renderer/features/chat/task-list-panel"
import { ChatShell } from "@renderer/features/chat/chat-shell"
import { ArtifactsPanel } from "@renderer/features/artifacts-panel/artifacts-panel"
import { SkillPacksPage } from "@renderer/features/skill-packs/skill-packs-page"
import { ScheduledPage } from "@renderer/features/scheduled/scheduled-page"
import { LibraryPage } from "@renderer/features/library/library-page"
import { SettingsDialog } from "@renderer/features/settings/settings-dialog"
import { OnboardingDialog } from "@renderer/components/onboarding-dialog"
import { useSettingsOpen } from "@renderer/stores/ui-store"
import { useThemeStore } from "@renderer/stores/theme-store"

/**
 * 根布局: 48px 功能导航栏 + 视图区（任务视图 = 左任务列表 + 右会话详情 + 产物浮窗；其余全页） + 全局对话框
 */
export default function App() {
  const activeView = useSettingsOpen((s) => s.activeView)

  // 主题初始化（从 settings 读取偏好并应用）
  const initTheme = useThemeStore((s) => s.init)
  useEffect(() => {
    void initTheme()
  }, [initTheme])

  // 首次启动引导
  const [onboarding, setOnboarding] = useState(false)
  useEffect(() => {
    void window.nexa.getSettings().then((s: { initialized?: boolean }) => {
      if (!s.initialized) setOnboarding(true)
    })
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <NavRail />
      {activeView === "skill-packs" ? (
        <main className="min-w-0 flex-1">
          <SkillPacksPage />
        </main>
      ) : activeView === "scheduled" ? (
        <main className="min-w-0 flex-1">
          <ScheduledPage />
        </main>
      ) : activeView === "library" ? (
        <main className="min-w-0 flex-1">
          <LibraryPage />
        </main>
      ) : (
        <>
          <TaskListPanel />
          <ChatShell />
          <ArtifactsPanel />
        </>
      )}
      {/* 设置全局弹框 */}
      <SettingsDialog />
      {onboarding && <OnboardingDialog onClose={() => setOnboarding(false)} />}
    </div>
  )
}
