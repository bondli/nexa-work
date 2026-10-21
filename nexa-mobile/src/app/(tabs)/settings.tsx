/**
 * 设置页：多电脑配对管理（切换/解绑）、外观主题、通知设置
 */
import { useEffect, useMemo, useState } from "react"
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native"
import { router } from "expo-router"
import { Check, Monitor, X } from "lucide-react-native"
import { useTheme, useThemeMode, useChatFontSize, type ChatFontSize } from "@/lib/theme"
import { NOTICE_SOUND_OPTIONS } from "@/lib/notice-sound"
import { pushAvailable } from "@/lib/push"
import { useRelayStore } from "@/lib/relay/service"
import { storage } from "@/lib/relay/storage"
import { ConfirmDialog } from "@/components/confirm-dialog"

/** 外观三选项：key 与 ThemeMode 对齐 */
const APPEARANCE_OPTIONS = [
  { key: "system", label: "系统" },
  { key: "light", label: "浅色" },
  { key: "dark", label: "深色" },
] as const

/** 消息字号三选项（仅作用于任务详情页消息正文） */
const FONT_SIZE_OPTIONS: ChatFontSize[] = [12, 14, 16]

export default function SettingsScreen() {
  const { colors: t } = useTheme()
  // 主题模式：仅消费 store（选择结果持久化，全局生效）
  const mode = useThemeMode((s) => s.mode)
  const setMode = useThemeMode((s) => s.setMode)
  const chatFontSize = useChatFontSize((s) => s.size)
  const setChatFontSize = useChatFontSize((s) => s.setSize)
  const status = useRelayStore((s) => s.status)
  const notifyEnabled = useRelayStore((s) => s.notifyEnabled)
  const setNotifyEnabled = useRelayStore((s) => s.setNotifyEnabled)
  const notifyPermission = useRelayStore((s) => s.notifyPermission)
  const refreshNotifyPermission = useRelayStore((s) => s.refreshNotifyPermission)
  const openNotifySettings = useRelayStore((s) => s.openNotificationSettings)
  const noticeSound = useRelayStore((s) => s.noticeSound)
  const setNoticeSound = useRelayStore((s) => s.setNoticeSound)
  const switchDesktop = useRelayStore((s) => s.switchDesktop)
  const unbindDesktop = useRelayStore((s) => s.unbindDesktop)
  const pairings = useRelayStore((s) => s.pairings)
  const currentDesktopId = useRelayStore((s) => s.currentDesktopId)
  const [relayUrl, setRelayUrl] = useState("")
  // 解绑二次确认（应用内弹框，替代系统 Alert）
  const [pendingUnbind, setPendingUnbind] = useState<{ id: string; name: string } | null>(null)
  const [unbinding, setUnbinding] = useState(false)

  useEffect(() => {
    void storage.getRelayUrl().then((u) => setRelayUrl(u ?? ""))
    // 进页面时校准系统通知权限（用户可能刚在系统设置里改过）
    void refreshNotifyPermission()
  }, [refreshNotifyPermission])

  // 样式随主题重建（亮/暗切换时自动生效）
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: t.bg },
        content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },
        /** 首个分组标题紧贴页面标题，去掉额外的上外边距 */
        sectionTitleFirst: { marginTop: 0 },
        sectionTitle: { color: t.textMuted, fontSize: 13, marginBottom: 8, marginTop: 8 },
        card: { backgroundColor: t.card, borderRadius: 12, padding: 14, gap: 12, marginBottom: 16 },
        row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
        rowLabel: { color: t.text, fontSize: 15 },
        rowValueWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
        rowValue: { color: t.textSecondary, fontSize: 14, flexShrink: 1 },
        mono: { fontFamily: "Menlo", fontSize: 12 },
        dot: { width: 8, height: 8, borderRadius: 4 },
        dotOnline: { backgroundColor: t.online },
        dotOffline: { backgroundColor: t.textMuted },
        textOnline: { color: t.success },
        textOffline: { color: t.textMuted },
        pairItem: {
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: t.subtle,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
          gap: 8,
        },
        pairItemCurrent: { borderWidth: 1, borderColor: t.accent },
        pairMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
        pairName: { color: t.textSecondary, fontSize: 14, flex: 1 },
        pairNameCurrent: { color: t.accent, fontWeight: "600" },
        notifyTextWrap: { flex: 1, gap: 2 },
        notifyHint: { color: t.textMuted, fontSize: 12 },
        // 通知权限提示行（点击跳系统设置）
        permissionRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: t.dangerSoft,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
        },
        permissionText: { flex: 1, color: t.danger, fontSize: 12 },
        permissionAction: { color: t.danger, fontSize: 12, fontWeight: "600" },
        // 外观单选组：右侧紧凑 pill 组
        radioGroup: { flexDirection: "row", gap: 6, backgroundColor: t.subtle, borderRadius: 10, padding: 3 },
        radioItem: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
        radioItemActive: { backgroundColor: t.accentSoft },
        // 四个提示音选项更紧凑，避免挤压左侧标签
        radioItemTight: { paddingHorizontal: 9 },
        groupDisabled: { opacity: 0.45 },
        radioText: { color: t.textMuted, fontSize: 13 },
        radioTextActive: { color: t.accent, fontWeight: "600" },
        actions: { gap: 8, marginTop: 4 },
        actionBtn: { borderRadius: 10, paddingVertical: 12, alignItems: "center" },
        actionPrimary: { backgroundColor: t.accentSoft },
        actionTextPrimary: { color: t.accent, fontSize: 14, fontWeight: "600" },
        footer: { color: t.textMuted, fontSize: 12, textAlign: "center", marginTop: 8 },
      }),
    [t]
  )

  /** 确认解绑：解绑当前电脑后回到配对页 */
  const confirmUnbind = async () => {
    if (!pendingUnbind || unbinding) return
    setUnbinding(true)
    try {
      const wasCurrent = await unbindDesktop(pendingUnbind.id)
      setPendingUnbind(null)
      if (wasCurrent) router.replace("/pair")
    } catch (e) {
      Alert.alert("解绑失败", e instanceof Error ? e.message : String(e))
    } finally {
      setUnbinding(false)
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 配对状态 */}
      <Text style={[styles.sectionTitle, styles.sectionTitleFirst]}>配对（{pairings.length} 台电脑）</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>连接状态</Text>
          <View style={styles.rowValueWrap}>
            <View style={[styles.dot, status.peerOnline ? styles.dotOnline : styles.dotOffline]} />
            <Text style={[styles.rowValue, status.peerOnline ? styles.textOnline : styles.textOffline]}>
              {status.peerOnline ? "已连接" : "离线"}
            </Text>
          </View>
        </View>
        {relayUrl ? (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>中继服务器</Text>
            <Text style={[styles.rowValue, styles.mono]} numberOfLines={1}>{relayUrl}</Text>
          </View>
        ) : null}

        {/* 配对列表：点击切换，X 解绑 */}
        {pairings.map((p) => {
          const isCurrent = p.desktopId === currentDesktopId
          return (
            <View key={p.desktopId} style={[styles.pairItem, isCurrent && styles.pairItemCurrent]}>
              <Pressable
                style={styles.pairMain}
                onPress={() => {
                  if (!isCurrent) void switchDesktop(p.desktopId).catch(() => {})
                }}
              >
                <Monitor size={17} color={isCurrent ? t.accent : t.textMuted} />
                <Text style={[styles.pairName, isCurrent && styles.pairNameCurrent]} numberOfLines={1}>
                  {p.name}
                </Text>
                {isCurrent ? <Check size={16} color={t.accent} /> : null}
              </Pressable>
              <Pressable hitSlop={8} onPress={() => setPendingUnbind({ id: p.desktopId, name: p.name })} accessibilityLabel="解绑">
                <X size={16} color={t.textMuted} />
              </Pressable>
            </View>
          )
        })}

        <View style={styles.actions}>
          <Pressable style={[styles.actionBtn, styles.actionPrimary]} onPress={() => router.push("/desktop-switch")}>
            <Text style={styles.actionTextPrimary}>切换 / 添加电脑</Text>
          </Pressable>
        </View>
      </View>

      {/* 外观设置：与通知一致的行形式，右侧单选组（系统/浅色/深色） */}
      <Text style={styles.sectionTitle}>外观</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>主题</Text>
          <View style={styles.radioGroup}>
            {APPEARANCE_OPTIONS.map((opt) => {
              const active = mode === opt.key
              return (
                <Pressable
                  key={opt.key}
                  style={[styles.radioItem, active && styles.radioItemActive]}
                  onPress={() => setMode(opt.key)}
                >
                  <Text style={[styles.radioText, active && styles.radioTextActive]}>{opt.label}</Text>
                </Pressable>
              )
            })}
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.notifyTextWrap}>
            <Text style={styles.rowLabel}>字体</Text>
            <Text style={styles.notifyHint}>任务详情页消息字号</Text>
          </View>
          <View style={styles.radioGroup}>
            {FONT_SIZE_OPTIONS.map((size) => {
              const active = chatFontSize === size
              return (
                <Pressable
                  key={size}
                  style={[styles.radioItem, active && styles.radioItemActive]}
                  onPress={() => setChatFontSize(size)}
                >
                  <Text style={[styles.radioText, active && styles.radioTextActive]}>{size}px</Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      </View>

      {/* 通知设置：对齐桌面端 —— 开关 + 提示音选择（切换即试听） */}
      <Text style={styles.sectionTitle}>通知</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.notifyTextWrap}>
            <Text style={styles.rowLabel}>任务通知</Text>
            <Text style={styles.notifyHint}>
              {pushAvailable
                ? "定时任务完成或失败时发系统通知（后台也会提醒）"
                : "当前 Preview 环境不支持系统通知，仅应用内提醒；安装正式包后自动启用"}
            </Text>
          </View>
          <Switch
            value={notifyEnabled}
            onValueChange={(v) => void setNotifyEnabled(v)}
            trackColor={{ false: t.border, true: t.accent }}
            thumbColor="#fff"
          />
        </View>
        {/* 系统通知权限被关闭：直接给入口跳系统设置，避免用户自己在应用管理里找 */}
        {pushAvailable && !notifyPermission ? (
          <Pressable
            style={styles.permissionRow}
            onPress={() => void openNotifySettings()}
            android_ripple={{ color: "transparent" }}
            accessibilityLabel="去系统设置开启通知"
          >
            <Text style={styles.permissionText}>系统通知权限未开启，点此去设置开启</Text>
            <Text style={styles.permissionAction}>去设置</Text>
          </Pressable>
        ) : null}
        <View style={styles.row}>
          <View style={styles.notifyTextWrap}>
            <Text style={styles.rowLabel}>通知音</Text>
            <Text style={styles.notifyHint}>切换后立即试听</Text>
          </View>
          <View style={[styles.radioGroup, notifyEnabled ? null : styles.groupDisabled]}>
            {NOTICE_SOUND_OPTIONS.map((name) => {
              const active = noticeSound === name
              return (
                <Pressable
                  key={name}
                  style={[styles.radioItem, styles.radioItemTight, active && styles.radioItemActive]}
                  onPress={() => void setNoticeSound(name)}
                  disabled={!notifyEnabled}
                >
                  <Text style={[styles.radioText, active && styles.radioTextActive]}>{name}</Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      </View>

      <Text style={styles.footer}>Nexa Mobile · 与桌面端配套使用</Text>

      {/* 解绑确认弹框（应用内主题化弹框，替代系统 Alert） */}
      <ConfirmDialog
        visible={!!pendingUnbind}
        title="解绑这台电脑？"
        message={pendingUnbind ? `「${pendingUnbind.name}」解绑后需要重新配对才能再次连接。` : undefined}
        confirmText="解绑"
        destructive
        loading={unbinding}
        onConfirm={() => void confirmUnbind()}
        onCancel={() => {
          if (!unbinding) setPendingUnbind(null)
        }}
      />
    </ScrollView>
  )
}
