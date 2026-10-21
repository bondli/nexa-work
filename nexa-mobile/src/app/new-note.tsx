/**
 * 新增笔记（modal）：标题 + 正文 → 写入桌面端 note 表，返回资料库
 */
import { useMemo, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { router } from "expo-router"
import { useTheme } from "@/lib/theme"
import { useRelayStore } from "@/lib/relay/service"

export default function NewNoteScreen() {
  const { colors: t } = useTheme()
  const createNote = useRelayStore((s) => s.createNote)
  const status = useRelayStore((s) => s.status)

  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [saving, setSaving] = useState(false)

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: t.bg },
        content: { padding: 16, gap: 10 },
        label: { color: t.textMuted, fontSize: 13 },
        titleInput: {
          backgroundColor: t.card,
          color: t.text,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 15,
        },
        bodyInput: {
          backgroundColor: t.card,
          color: t.text,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 15,
          minHeight: 220,
          textAlignVertical: "top",
        },
        saveBtn: { backgroundColor: t.accent, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 4 },
        btnDisabled: { opacity: 0.5 },
        saveText: { color: "#fff", fontWeight: "600", fontSize: 15 },
      }),
    [t]
  )

  const handleSave = async () => {
    const tt = title.trim()
    if (!tt || saving) return
    if (!status.peerOnline) {
      Alert.alert("电脑离线", "请先确认桌面端已连接")
      return
    }
    setSaving(true)
    try {
      await createNote({ title: tt, content: content.trim() })
      router.back()
    } catch (e) {
      Alert.alert("保存失败", e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>标题</Text>
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={setTitle}
          placeholder="给这条笔记起个标题"
          placeholderTextColor={t.textMuted}
          autoFocus
        />
        <Text style={styles.label}>正文</Text>
        <TextInput
          style={styles.bodyInput}
          value={content}
          onChangeText={setContent}
          placeholder="记点什么…（支持 Markdown）"
          placeholderTextColor={t.textMuted}
          multiline
        />
        <Pressable
          style={[styles.saveBtn, (!title.trim() || saving || !status.peerOnline) && styles.btnDisabled]}
          onPress={handleSave}
          disabled={!title.trim() || saving || !status.peerOnline}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>保存笔记</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
