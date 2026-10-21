/**
 * 系统级通知（本地推送）
 *
 * - Android 13+ 需要 POST_NOTIFICATIONS 授权，开关打开时申请
 * - Android 通知音只能走通知渠道（系统默认声/静音），自定义音色仍由应用内合成音播放
 * - 应用在后台时由系统通知提醒；前台时改为应用内弹窗 + 合成提示音（避免重复打扰）
 * - 注意：Expo Go 自 SDK 53 起移除了 expo-notifications 原生模块，直接 import 会让应用崩溃。
 *   因此这里用可选加载：Expo Go 下 pushAvailable=false，自动降级为应用内提醒；
 *   原生 dev build / 正式包中才启用系统通知。
 */
import { Linking, Platform } from "react-native"

type NotificationsModule = typeof import("expo-notifications")

let notifications: NotificationsModule | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  notifications = require("expo-notifications") as NotificationsModule
} catch {
  notifications = null
}

/** 当前运行环境是否支持系统通知（Expo Go 内为 false） */
export const pushAvailable = notifications !== null

/** 有提示音的通知渠道 */
const CHANNEL_SOUND = "nexa-task"
/** 静音通知渠道（用户选择「静音」时用） */
const CHANNEL_SILENT = "nexa-task-silent"

/** 注册前台展示策略（必须在 App 启动时调用一次） */
export function configureNotificationHandler(): void {
  if (!notifications) return
  notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  })
}

/** 创建 Android 通知渠道（两个：有声 / 静音）；iOS 无需渠道 */
export async function setupNotificationChannels(): Promise<void> {
  if (!notifications || Platform.OS !== "android") return
  try {
    await notifications.setNotificationChannelAsync(CHANNEL_SOUND, {
      name: "任务通知",
      importance: notifications.AndroidImportance.HIGH,
      // 不显式指定 sound：使用渠道默认通知声（传 "default" 会被当成自定义资源名去查找并告警）
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#3b82f6",
    })
    await notifications.setNotificationChannelAsync(CHANNEL_SILENT, {
      name: "任务通知（静音）",
      importance: notifications.AndroidImportance.HIGH,
      sound: null,
      vibrationPattern: [0, 250],
      lightColor: "#3b82f6",
    })
  } catch {
    /* 渠道创建失败不影响应用内提醒 */
  }
}

/** 查询是否已授权（不弹窗） */
export async function hasNotificationPermission(): Promise<boolean> {
  if (!notifications) return false
  try {
    const p = await notifications.getPermissionsAsync()
    return Boolean(p.granted)
  } catch {
    return false
  }
}

/** 申请通知权限（Android 13+ / iOS 会弹系统授权框）；返回最终是否授权 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!notifications) return false
  try {
    const current = await notifications.getPermissionsAsync()
    if (current.granted) return true
    // Android 渠道必须先建立，否则权限弹窗与通知都无法展示
    await setupNotificationChannels()
    const req = await notifications.requestPermissionsAsync()
    return Boolean(req.granted)
  } catch {
    return false
  }
}

/** 打开本应用的通知设置页（Android 跳应用详情，iOS 跳系统设置） */
export async function openNotificationSettings(): Promise<void> {
  try {
    await Linking.openSettings()
  } catch {
    /* 系统不支持时静默失败，用户可自行前往设置 */
  }
}

/** 取消所有尚未触发的本地通知（关闭通知开关时调用） */
export async function cancelPendingNotifications(): Promise<void> {
  if (!notifications) return
  try {
    await notifications.cancelAllScheduledNotificationsAsync()
  } catch {
    /* 无权限/无模块时忽略 */
  }
}

/**
 * 立即推送一条系统通知。
 * @param silent 用户选择「静音」时为 true（走静音渠道，且不播放声音）
 * @returns 是否成功交给系统展示（无权限/异常/Expo Go 时为 false，调用方可回退应用内提示）
 */
export async function showTaskNotification(params: {
  title: string
  body: string
  silent: boolean
}): Promise<boolean> {
  if (!notifications) return false
  try {
    if (!(await hasNotificationPermission())) return false
    // SDK 58 起 Android 的通知渠道改由 trigger 指定（content.channelId 不再生效，会落到 fallback 渠道）
    const channelId = params.silent ? CHANNEL_SILENT : CHANNEL_SOUND
    await notifications.scheduleNotificationAsync({
      content: {
        title: params.title,
        body: params.body.slice(0, 300),
        // 静音时 false，有声时 true（布尔表示使用渠道默认通知声）
        sound: !params.silent,
      },
      trigger:
        Platform.OS === "android"
          ? { type: notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1, channelId }
          : null,
    })
    return true
  } catch {
    return false
  }
}
