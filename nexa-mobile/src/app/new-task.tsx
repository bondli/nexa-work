/**
 * 新建任务（modal）：输入任务描述（可选附图片）→ 创建并跳转任务详情
 */
import { useMemo, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { router } from "expo-router"
import { Plus, X } from "lucide-react-native"
import { useTheme } from "@/lib/theme"
import { useRelayStore } from "@/lib/relay/service"
import { pickAndCompressImages, type PickedImage } from "@/lib/image-picker"

export default function NewTaskScreen() {
  const { colors: t } = useTheme()
  const createTask = useRelayStore((s) => s.createTask)
  const status = useRelayStore((s) => s.status)

  const [prompt, setPrompt] = useState("")
  const [sending, setSending] = useState(false)
  // 随首条消息发送的图片附件（桌面端落盘后由 Agent 处理/收藏）
  const [pendingImages, setPendingImages] = useState<PickedImage[]>([])
  const [picking, setPicking] = useState(false)

  // 样式随主题重建（亮/暗切换时自动生效）
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: t.bg, padding: 16, gap: 12 },
        labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
        label: { color: t.textMuted, fontSize: 13 },
        input: {
          backgroundColor: t.card,
          color: t.text,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 15,
          minHeight: 120,
          textAlignVertical: "top",
        },
        sendBtn: { backgroundColor: t.accent, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
        btnDisabled: { opacity: 0.5 },
        // 蓝底白字，白色按钮文字保持不变
        sendText: { color: "#fff", fontWeight: "600", fontSize: 15 },
        // + 号选图按钮
        plusBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.card, alignItems: "center", justifyContent: "center" },
        // 待发送图片缩略图行
        thumbRow: { flexDirection: "row", gap: 8 },
        thumbWrap: { width: 56, height: 56, borderRadius: 8, overflow: "hidden" },
        thumb: { width: 56, height: 56 },
        thumbRemove: {
          position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: 9,
          backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center",
        },
        hint: { color: t.textMuted, fontSize: 12 },
      }),
    [t]
  )

  const pickImages = async () => {
    if (picking) return
    setPicking(true)
    try {
      const next = await pickAndCompressImages()
      if (!next) return
      setPendingImages((prev) => [...prev, ...next].slice(0, 3))
    } catch (e) {
      Alert.alert("选择图片失败", e instanceof Error ? e.message : String(e))
    } finally {
      setPicking(false)
    }
  }

  const handleCreate = async () => {
    const p = prompt.trim()
    if (!p || sending) return
    if (!status.peerOnline) {
      Alert.alert("电脑离线", "请先确认桌面端已连接")
      return
    }
    setSending(true)
    try {
      const r = await createTask(
        p,
        undefined,
        pendingImages.map(({ name, mimeType, dataUrl }) => ({ name, mimeType, dataUrl }))
      )
      setPrompt("")
      setPendingImages([])
      // 替换掉 modal 自身，直接落到任务详情
      if (r?.sessionId) router.replace(`/session/${r.sessionId}`)
      else router.back()
    } catch (e) {
      Alert.alert("创建失败", e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>任务描述</Text>
        <Pressable style={styles.plusBtn} onPress={() => void pickImages()} disabled={picking} accessibilityLabel="添加图片">
          {picking ? <ActivityIndicator size="small" color={t.textMuted} /> : <Plus size={18} color={t.textMuted} />}
        </Pressable>
      </View>
      <TextInput
        style={styles.input}
        value={prompt}
        onChangeText={setPrompt}
        placeholder="例如：帮我整理今天的新闻要点…"
        placeholderTextColor={t.textMuted}
        multiline
        autoFocus
      />
      {/* 待发送图片缩略图（可点 x 移除） */}
      {pendingImages.length > 0 && (
        <View style={styles.thumbRow}>
          {pendingImages.map((img, i) => (
            <View key={img.previewUri} style={styles.thumbWrap}>
              <Image source={{ uri: img.previewUri }} style={styles.thumb} />
              <Pressable
                style={styles.thumbRemove}
                onPress={() => setPendingImages((prev) => prev.filter((_, idx) => idx !== i))}
                accessibilityLabel="移除图片"
              >
                <X size={12} color="#fff" />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {pendingImages.length > 0 ? <Text style={styles.hint}>图片将随任务首条消息一起发送</Text> : null}
      <Pressable
        style={[styles.sendBtn, (!prompt.trim() || sending || !status.peerOnline) && styles.btnDisabled]}
        onPress={handleCreate}
        disabled={!prompt.trim() || sending || !status.peerOnline}
      >
        {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>创建任务</Text>}
      </Pressable>
    </KeyboardAvoidingView>
  )
}
