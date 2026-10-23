/**
 * 任务页（首页）：当前电脑标识 + 按编码/自由任务分组展示
 * 点击任务进详情，右上角 + 号新建任务
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Link, router, useFocusEffect } from "expo-router"
import { CheckCircle2, ChevronDown, ChevronRight, Monitor, Pause, XCircle } from "lucide-react-native"
import { useTheme } from "@/lib/theme"
import { useRelayStore } from "@/lib/relay/service"
import { fmtTsShort } from "@/lib/time"
import type { SessionSummary } from "@/lib/relay/protocol"

/** 会话列表分区：自由任务一组；编码任务按项目文件夹名分组 */
type SessionSection = { key: string; title: string; data: SessionSummary[] }

/** 取项目路径的文件夹名（与桌面端一致的分组依据） */
function folderName(projectPath: string | null | undefined): string {
  if (!projectPath) return "未知项目"
  const parts = String(projectPath).replace(/\/+$/, "").split("/")
  return parts[parts.length - 1] || "未知项目"
}

export default function TasksScreen() {
  const { colors: t } = useTheme()
  const status = useRelayStore((s) => s.status)
  const sessions = useRelayStore((s) => s.sessions)
  const loadingSessions = useRelayStore((s) => s.loadingSessions)
  const loadSessions = useRelayStore((s) => s.loadSessions)
  const pairings = useRelayStore((s) => s.pairings)
  const currentDesktopId = useRelayStore((s) => s.currentDesktopId)
  const [refreshing, setRefreshing] = useState(false)
  // 折叠状态：key 集合（自由任务 / 各编码项目组）
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // 桌面在线时拉取列表；切回本页也刷新
  useEffect(() => {
    if (status.peerOnline) void loadSessions()
  }, [status.peerOnline, loadSessions])

  useFocusEffect(
    useCallback(() => {
      if (status.peerOnline) void loadSessions()
    }, [status.peerOnline, loadSessions])
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await loadSessions()
    setRefreshing(false)
  }, [loadSessions])

  // 分组：自由任务在前；编码任务按文件夹目录名分组在后，组内按更新时间倒序；已归档任务独立成组
  const sections: SessionSection[] = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    const active = sorted.filter((s) => !s.archived)
    const archived = sorted.filter((s) => s.archived)
    const free = active.filter((s) => s.mode !== "project")
    const out: SessionSection[] = []
    if (free.length) out.push({ key: "free", title: `自由任务 · ${free.length}`, data: free })
    const byFolder = new Map<string, SessionSummary[]>()
    for (const s of active.filter((x) => x.mode === "project")) {
      const folder = folderName(s.projectPath)
      const arr = byFolder.get(folder) ?? []
      arr.push(s)
      byFolder.set(folder, arr)
    }
    for (const [folder, list] of byFolder) {
      out.push({ key: `project:${folder}`, title: `${folder} · ${list.length}`, data: list })
    }
    // 归档任务：排在最后，独立一组（避免与在用任务混在一起）
    if (archived.length) out.push({ key: "archived", title: `已归档 · ${archived.length}`, data: archived })
    return out
  }, [sessions])

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // 样式随主题重建（亮/暗切换时自动生效）
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: t.bg },
        desktopBar: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          marginHorizontal: 12,
          marginTop: 6,
          marginBottom: 2,
          paddingHorizontal: 10,
          paddingVertical: 7,
          borderRadius: 10,
          backgroundColor: t.card,
          alignSelf: "flex-start",
          maxWidth: "90%",
        },
        dot: { width: 7, height: 7, borderRadius: 4 },
        dotOnline: { backgroundColor: t.online },
        dotOffline: { backgroundColor: t.textMuted },
        desktopName: { color: t.textSecondary, fontSize: 13, fontWeight: "500", flexShrink: 1, maxWidth: 180 },
        desktopState: { color: t.textMuted, fontSize: 11 },
        listContent: { paddingBottom: 24 },
        sectionHeader: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
        sectionTitle: { color: t.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 0.5 },
        empty: { padding: 48, alignItems: "center" },
        emptyText: { color: t.textMuted, fontSize: 14, textAlign: "center" },
        // 任务卡片：白色圆角卡片，左状态图标 + 右侧「任务名 / 时间」两行
        card: {
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          marginHorizontal: 12,
          marginBottom: 8,
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: t.border,
          backgroundColor: t.card,
        },
        statusWrap: { width: 20, alignItems: "center", justifyContent: "center" },
        cardBody: { flex: 1, minWidth: 0 },
        modeBadge: { fontSize: 10, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, overflow: "hidden" },
        badgeCode: { color: t.badgeCode, backgroundColor: t.badgeCodeSoft },
        itemTitle: { color: t.text, fontSize: 15, fontWeight: "500", flexShrink: 1 },
        itemTime: { color: t.textMuted, fontSize: 12, marginTop: 4 },
      }),
    [t]
  )

  // 当前电脑名称（配对记录里的名字，优先于 hello 推送的 peer.name）
  const currentDesktop =
    pairings.find((p) => p.desktopId === currentDesktopId)?.name ?? status.peer?.name ?? "未配对电脑"
  const online = status.peerOnline

  return (
    <View style={styles.container}>
      {/* 当前电脑标识：点击切换/添加 */}
      <Pressable style={styles.desktopBar} onPress={() => router.push("/desktop-switch")}>
        <View style={[styles.dot, online ? styles.dotOnline : styles.dotOffline]} />
        <Monitor size={14} color={t.textMuted} />
        <Text style={styles.desktopName} numberOfLines={1}>{currentDesktop}</Text>
        <Text style={styles.desktopState}>{online ? "在线" : "离线"}</Text>
        <ChevronDown size={16} color={t.textMuted} />
      </Pressable>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            {loadingSessions ? (
              <ActivityIndicator color={t.accent} />
            ) : (
              <Text style={styles.emptyText}>{online ? "还没有任务，点右上角 + 新建" : "电脑离线，无法获取任务"}</Text>
            )}
          </View>
        }
        renderSectionHeader={({ section }) => {
          const isCollapsed = collapsed.has(section.key)
          return (
            <Pressable style={styles.sectionHeader} onPress={() => toggle(section.key)}>
              {isCollapsed ? (
                <ChevronRight size={14} color={t.textMuted} />
              ) : (
                <ChevronDown size={14} color={t.textMuted} />
              )}
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </Pressable>
          )
        }}
        stickySectionHeadersEnabled={false}
        renderItem={({ item, section }) =>
          // 折叠的组不渲染条目；renderItem 由 SectionList 按 data 逐条调用，只渲染单条
          collapsed.has(section.key) ? null : (
            <Link href={`/session/${item.id}`} asChild>
              <Pressable style={styles.card} android_ripple={{ color: "transparent" }}>
                {/* 左侧状态图标：进行中显示 loading，失败/暂停/完成各用对应图标 */}
                <View style={styles.statusWrap}>
                  {item.status === "running" ? (
                    <ActivityIndicator size="small" color={t.accent} />
                  ) : item.status === "failed" ? (
                    <XCircle size={18} color={t.danger} />
                  ) : item.status === "paused" ? (
                    <Pause size={18} color={t.textMuted} />
                  ) : (
                    <CheckCircle2 size={18} color={t.success} />
                  )}
                </View>
                <View style={styles.cardBody}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{item.title || "未命名会话"}</Text>
                    {item.mode === "project" ? (
                      <Text style={[styles.modeBadge, styles.badgeCode]}>编码</Text>
                    ) : null}
                  </View>
                  <Text style={styles.itemTime} numberOfLines={1}>
                    {item.updatedAt ? fmtTsShort(item.updatedAt) : ""}
                  </Text>
                </View>
                {/* 进入箭头：右侧入栈指示，明确「点进去」的入口 */}
                <ChevronRight size={18} color={t.textMuted} />
              </Pressable>
            </Link>
          )
        }
      />
    </View>
  )
}
