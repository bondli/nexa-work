/**
 * 执行记录页：某个定时任务的运行历史；点击记录跳转关联任务详情
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
import { useLocalSearchParams, useRouter } from "expo-router"
import { useTheme } from "@/lib/theme"
import { useRelayStore } from "@/lib/relay/service"
import { fmtTsFull } from "@/lib/time"

function fmtTs(ts: number | null | undefined): string {
  return fmtTsFull(ts)
}

export default function JobRunsScreen() {
  const { colors: t } = useTheme()
  const params = useLocalSearchParams()
  const router = useRouter()
  const jobId = String(params.jobId ?? "")

  const jobs = useRelayStore((s) => s.jobs)
  const runs = useRelayStore((s) => s.jobRuns[jobId]) ?? []
  const loadJobRuns = useRelayStore((s) => s.loadJobRuns)
  const status = useRelayStore((s) => s.status)
  const [refreshing, setRefreshing] = useState(false)

  const job = jobs.find((j) => j.id === jobId)

  useEffect(() => {
    if (jobId && status.peerOnline) void loadJobRuns(jobId)
  }, [jobId, status.peerOnline, loadJobRuns])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await loadJobRuns(jobId)
    setRefreshing(false)
  }, [jobId, loadJobRuns])

  // 样式随主题重建（亮/暗切换时自动生效）
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: t.bg },
        jobCard: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.card, gap: 4 },
        jobTitle: { color: t.text, fontSize: 15, fontWeight: "600" },
        jobMeta: { color: t.textMuted, fontSize: 12, fontFamily: "Menlo" },
        listContent: { padding: 12, paddingBottom: 24, gap: 10 },
        empty: { padding: 48, alignItems: "center" },
        emptyText: { color: t.textMuted, fontSize: 14 },
        sep: { height: 0 },
        runItem: { backgroundColor: t.card, borderRadius: 12, padding: 14, gap: 6 },
        runHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
        runBadge: { fontSize: 11, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
        badgeOk: { color: t.success, backgroundColor: t.successSoft },
        badgeFail: { color: t.danger, backgroundColor: t.dangerSoft },
        runTime: { color: t.textMuted, fontSize: 12 },
        runOutput: { color: t.textSecondary, fontSize: 13, lineHeight: 19 },
        runLink: { color: t.accent, fontSize: 12, marginTop: 2 },
      }),
    [t]
  )

  return (
    <View style={styles.container}>
      {job ? (
        <View style={styles.jobCard}>
          <Text style={styles.jobTitle} numberOfLines={2}>{job.description || "未命名任务"}</Text>
          <Text style={styles.jobMeta}>{job.cron_expr} · {job.handler_type}</Text>
        </View>
      ) : null}

      <FlatList
        data={runs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <ActivityIndicator color={t.accent} style={{ marginBottom: 8 }} />
            <Text style={styles.emptyText}>暂无执行记录</Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item }) => (
          <Pressable
            style={styles.runItem}
            onPress={() => {
              // 有关联会话的记录 → 跳任务详情
              if (item.session_id) router.push(`/session/${item.session_id}`)
            }}
            disabled={!item.session_id}
          >
            <View style={styles.runHead}>
              <Text style={[styles.runBadge, item.success ? styles.badgeOk : styles.badgeFail]}>
                {item.success ? "成功" : "失败"}
              </Text>
              <Text style={styles.runTime}>{fmtTs(item.started_at)}</Text>
            </View>
            <Text style={styles.runOutput} numberOfLines={3}>
              {String(item.output ?? "（无输出）")}
            </Text>
            {item.session_id ? <Text style={styles.runLink}>查看关联任务详情 →</Text> : null}
          </Pressable>
        )}
      />
    </View>
  )
}
