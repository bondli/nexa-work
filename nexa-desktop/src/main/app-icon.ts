/**
 * 应用图标主题切换。
 * 按实际明暗主题（nativeTheme.shouldUseDarkColors）切换：
 * - 深色：黑色底板 + 白色图形（icon.png）
 * - 浅色：白色底板 + 黑色图形（icon-light.png）
 *
 * 主题偏好由 settings 同步到 nativeTheme.themeSource（见 index.ts），
 * 因此「跟随系统」时系统外观变化也会触发 nativeTheme.updated。
 * 注意：nativeImage.createFromPath 加载不了 .icns，运行时必须用 PNG；
 * 打包后的启动器图标由 electron-builder 固定，运行时能切的是 Dock / 任务栏图标。
 */
import { app, nativeImage, nativeTheme, type BrowserWindow } from "electron"
import { existsSync } from "node:fs"
import { join } from "node:path"

/** 开发态与打包后都兼容：按候选路径存在性探测 */
function resolveIconPath(filename: string): string {
  const candidates = [
    join(__dirname, "../../assets", filename), // out/main → 项目 assets
    join(process.resourcesPath, "assets", filename), // 打包后 Resources/assets
    join(app.getAppPath(), "assets", filename),
  ]
  return candidates.find((p) => existsSync(p)) ?? candidates[0]
}

const darkIcon = nativeImage.createFromPath(resolveIconPath("icon.png"))
const lightIcon = nativeImage.createFromPath(resolveIconPath("icon-light.png"))

/** 主窗口引用：Windows / Linux 的任务栏图标挂在窗口上，需要随主题同步 */
let trackedWindow: BrowserWindow | null = null

function applyIconByTheme(): void {
  const icon = nativeTheme.shouldUseDarkColors ? darkIcon : lightIcon
  if (icon.isEmpty()) return

  if (process.platform === "darwin") {
    app.dock?.setIcon(icon)
  }
  if (trackedWindow && !trackedWindow.isDestroyed()) {
    trackedWindow.setIcon(icon)
  }
}

/** 注册主窗口，主题变化时自动更新其图标 */
export function registerIconWindow(window: BrowserWindow): void {
  trackedWindow = window
  window.on("closed", () => {
    if (trackedWindow === window) trackedWindow = null
  })
  applyIconByTheme()
}

/** 初始化：立即应用一次，并监听主题变化 */
export function initAppIcon(): void {
  applyIconByTheme()
  nativeTheme.on("updated", applyIconByTheme)
}
