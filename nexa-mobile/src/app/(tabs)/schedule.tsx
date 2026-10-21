/**
 * 定时任务页：任务列表，点击进执行记录
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { router, useFocusEffect } from "expo-router"
import { useTheme } from "@/lib/theme"
import { useRelayStore } from "@/lib/relay/service"
import { fmtTsShort } from "@/lib/time"

function fmtTs(ts: number | null | undefined): string {
  return ts ? fmtTsShort(ts) : "—"
}

export default function ScheduleScreen() {
  const { colors: t } = useTheme()
  const status = useRelayStore((s) => s.status)
  const jobs = useRelayStore((s) => s.jobs)
  const loadingJobs = useRelayStore((s) => s.loadingJobs)
  const scheduleError = useRelayStore((s) => s.scheduleError)
  const loadJobs = useRelayStore((s) => s.loadJobs)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (status.peerOnline) void loadJobs()
  }, [status.peerOnline, loadJobs])

  useFocusEffect(
    useCallback(() => {
      if (status.peerOnline) void loadJobs()
    }, [status.peerOnline, loadJobs])
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await loadJobs()
    setRefreshing(false)
  }, [loadJobs])

  // 样式随主题重建（亮/暗切换时自动生效）
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: t.bg },
        listContent: { padding: 12, paddingBottom: 24, gap: 10 },
        empty: { padding: 48, alignItems: "center" },
        emptyText: { color: t.textMuted, fontSize: 14, textAlign: "center" },
        sep: { height: 0 },
        item: {
          backgroundColor: t.card,
          borderRadius: 12,
          padding: 14,
          gap: 6,
        },
        itemHead: { flexDirection: "row", alignItems: "center", gap: 8 },
        badge: { fontSize: 11, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
        badgeOn: { color: t.success, backgroundColor: t.successSoft },
        // 半透明中性灰底两种主题下均可读，保持不变
        badgeOff: { color: t.textMuted, backgroundColor: "rgba(115,115,115,0.15)" },
        cron: { color: t.accent, fontSize: 12, fontFamily: "Menlo" },
        itemTitle: { color: t.text, fontSize: 15, fontWeight: "500", lineHeight: 21 },
        itemMeta: { color: t.textMuted, fontSize: 12 },
        itemLink: { color: t.accent, fontSize: 12, marginTop: 2 },
      }),
    [t]
  )

  return (
    <View style={styles.container}>
      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            {loadingJobs ? (
              <ActivityIndicator color={t.accent} />
            ) : (
              <Text style={styles.emptyText}>
                {scheduleError
                  ? scheduleError
                  : status.peerOnline
                    ? "还没有定时任务，可在桌面端创建"
                    : "电脑离线，无法获取定时任务"}
              </Text>
            )}
          </View>
        }
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item }) => (
          // 用 Pressable 而非 View：Link asChild 依赖子组件透传 onPress，View 不接收导致点击无效
          <Pressable style={styles.item} onPress={() => router.push(`/job/${item.id}`)}>
            <View style={styles.itemHead}>
              <Text style={[styles.badge, item.enabled ? styles.badgeOn : styles.badgeOff]}>
                {item.enabled ? "启用" : "停用"}
              </Text>
              <Text style={styles.cron} numberOfLines={1}>{item.cron_expr}</Text>
            </View>
            <Text style={styles.itemTitle} numberOfLines={2}>{item.description || "未命名任务"}</Text>
            <Text style={styles.itemMeta}>
              {item.handler_type} · 上次 {fmtTs(item.last_run_at)} · 下次 {fmtTs(item.next_run_at)}
            </Text>
            <Text style={styles.itemLink}>查看执行记录 →</Text>
          </Pressable>
        )}
      />
    </View>
  )
}
