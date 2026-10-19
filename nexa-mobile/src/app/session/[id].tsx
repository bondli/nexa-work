import { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useRelayStore } from "@/lib/relay/service"
import type { ChatMessage } from "@/lib/relay/protocol"

export default function SessionScreen() {
  const params = useLocalSearchParams()
  const router = useRouter()
  const sessionId = String(params.id ?? "")

  const status = useRelayStore((s) => s.status)
  const messages = useRelayStore((s) => s.messages[sessionId] ?? [])
  const loadMessages = useRelayStore((s) => s.loadMessages)
  const sendMessage = useRelayStore((s) => s.sendMessage)

  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const listRef = useRef<FlatList<ChatMessage>>(null)

  useEffect(() => {
    if (sessionId) void loadMessages(sessionId)
  }, [sessionId, loadMessages])

  // 被解绑 → 回首页
  useEffect(() => {
    if (!status.connected) router.replace("/home")
  }, [status.connected, router])

  const handleSend = useCallback(async () => {
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    try {
      await sendMessage(sessionId, t)
      setText("")
    } catch (e) {
      Alert.alert("发送失败", e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }, [text, sending, sendMessage, sessionId])

  const renderItem = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === "user"
    return (
      <View style={[styles.bubbleRow, isUser ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
          <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant]}>
            {item.content}
          </Text>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item, idx) => item.id ?? `m-${idx}`}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <View style={styles.empty}>
            <ActivityIndicator color="#3b82f6" />
          </View>
        }
        renderItem={renderItem}
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="输入消息…"
          placeholderTextColor="#737373"
          multiline
        />
        <Pressable
          style={[styles.sendBtn, (!text.trim() || sending) && styles.btnDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || sending}
        >
          {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>发送</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  listContent: { padding: 12, gap: 10 },
  empty: { padding: 40, alignItems: "center" },
  bubbleRow: { flexDirection: "row" },
  bubbleRowRight: { justifyContent: "flex-end" },
  bubbleRowLeft: { justifyContent: "flex-start" },
  bubble: { maxWidth: "82%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: "#3b82f6" },
  bubbleAssistant: { backgroundColor: "#262626" },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextUser: { color: "#fff" },
  bubbleTextAssistant: { color: "#fafafa" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: "#262626" },
  input: {
    flex: 1, backgroundColor: "#171717", color: "#fafafa", borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 10, fontSize: 15, maxHeight: 120,
  },
  sendBtn: { backgroundColor: "#3b82f6", borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12, justifyContent: "center" },
  btnDisabled: { opacity: 0.5 },
  sendText: { color: "#fff", fontWeight: "600" },
})
