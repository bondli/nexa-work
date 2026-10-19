import { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { useRouter } from "expo-router"
import { unbindAndReset, useRelayStore } from "@/lib/relay/service"

export default function HomeScreen() {
  const router = useRouter()
  const status = useRelayStore((s) => s.status)
  const sessions = useRelayStore((s) => s.sessions)
  const loadingSessions = useRelayStore((s) => s.loadingSessions)
  const loadSessions = useRelayStore((s) => s.loadSessions)
  const createTask = useRelayStore((s) => s.createTask)

  const [prompt, setPrompt] = useState("")
  const [sending, setSending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // 被解绑 → 回配对页
  useEffect(() => {
    if (!status.peer && !status.connected) {
      // token 被清
    }
  }, [status])

  useEffect(() => {
    if (status.peerOnline) void loadSessions()
  }, [status.peerOnline, loadSessions])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await loadSessions()
    setRefreshing(false)
  }, [loadSessions])

  const handleCreate = useCallback(async () => {
    const p = prompt.trim()
    if (!p || sending) return
    setSending(true)
    try {
      const r = await createTask(p)
      setPrompt("")
      if (r?.sessionId) router.push(`/session/${r.sessionId}`)
    } catch (e) {
      Alert.alert("发送失败", e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }, [prompt, sending, createTask, router])

  const peer = status.peer
  const online = status.peerOnline

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
      {/* 桌面状态 */}
      <View style={styles.statusBar}>
        <View style={styles.statusDotRow}>
          <View style={[styles.dot, online ? styles.dotOnline : styles.dotOffline]} />
          <Text style={styles.statusText}>
            {online ? `${peer?.name ?? "电脑"} 在线` : "电脑离线"}
          </Text>
        </View>
        {peer && (
          <Text style={styles.deviceName} numberOfLines={1}>{peer.deviceId}</Text>
        )}
      </View>

      {/* 新建任务 */}
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={prompt}
          onChangeText={setPrompt}
          placeholder="发个任务让电脑帮你做…"
          placeholderTextColor="#737373"
          multiline
        />
        <Pressable
          style={[styles.sendBtn, (!prompt.trim() || sending) && styles.btnDisabled]}
          onPress={handleCreate}
          disabled={!prompt.trim() || sending}
        >
          {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>发送</Text>}
        </Pressable>
      </View>

      {/* 会话列表 */}
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            {loadingSessions ? (
              <ActivityIndicator color="#3b82f6" />
            ) : (
              <Text style={styles.emptyText}>还没有会话，试试发一个任务</Text>
            )}
          </View>
        }
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item }) => (
          <Pressable
            style={styles.sessionItem}
            onPress={() => router.push(`/session/${item.id}`)}
          >
            <Text style={styles.sessionTitle} numberOfLines={1}>{item.title || "未命名会话"}</Text>
            <View style={styles.sessionMeta}>
              <Text style={styles.sessionMode}>{item.mode === "project" ? "项目" : "自由"}</Text>
              {item.status ? <Text style={styles.sessionStatus}>· {item.status}</Text> : null}
            </View>
          </Pressable>
        )}
      />

      {/* 底部导航 */}
      <View style={styles.tabBar}>
        <Pressable style={styles.tabBtn} onPress={() => router.push("/library")}>
          <Text style={styles.tabText}>资料库</Text>
        </Pressable>
        <Pressable style={styles.unbindBtn} onPress={() => { unbindAndReset().then(() => router.replace("/pair")) }}>
          <Text style={styles.unbindText}>解绑此电脑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  statusBar: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#262626" },
  statusDotRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOnline: { backgroundColor: "#22c55e" },
  dotOffline: { backgroundColor: "#737373" },
  statusText: { color: "#fafafa", fontSize: 14, fontWeight: "600" },
  deviceName: { color: "#737373", fontSize: 11, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", marginTop: 2 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: "#262626" },
  input: {
    flex: 1, backgroundColor: "#171717", color: "#fafafa", borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 10, fontSize: 15, maxHeight: 120,
  },
  sendBtn: { backgroundColor: "#3b82f6", borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12, justifyContent: "center" },
  btnDisabled: { opacity: 0.5 },
  sendText: { color: "#fff", fontWeight: "600" },
  empty: { padding: 40, alignItems: "center" },
  emptyText: { color: "#737373", fontSize: 14 },
  sep: { height: 1, backgroundColor: "#171717" },
  sessionItem: { paddingHorizontal: 16, paddingVertical: 14 },
  sessionTitle: { color: "#fafafa", fontSize: 15, fontWeight: "500" },
  sessionMeta: { flexDirection: "row", alignItems: "center", marginTop: 4, gap: 4 },
  sessionMode: { color: "#3b82f6", fontSize: 11 },
  sessionStatus: { color: "#737373", fontSize: 11 },
  unbindBtn: { padding: 16, alignItems: "center" },
  unbindText: { color: "#f87171", fontSize: 14 },
  tabBar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#262626", alignItems: "center" },
  tabBtn: { flex: 1, padding: 16, alignItems: "center", borderRightWidth: 1, borderRightColor: "#262626" },
  tabText: { color: "#3b82f6", fontSize: 14 },
})
