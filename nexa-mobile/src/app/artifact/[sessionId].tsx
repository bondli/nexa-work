/**
 * 产物预览页：读取任务 workspace 下的 md/html 文档并渲染
 * - md：Markdown 渲染
 * - html：WebView 直接渲染源码（相对资源无法加载，纯内联样式页面可完整呈现）
 */
import { useEffect, useMemo, useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"
import { useLocalSearchParams } from "expo-router"
import Markdown from "react-native-markdown-display"
import { WebView } from "react-native-webview"
import { useTheme } from "@/lib/theme"
import { useRelayStore } from "@/lib/relay/service"

export default function ArtifactPreviewScreen() {
  const { colors: t } = useTheme()
  const params = useLocalSearchParams()
  const sessionId = String(params.sessionId ?? "")
  const relPath = String(params.path ?? "")
  const name = String(params.name ?? relPath.split("/").pop() ?? "产物")

  const readArtifact = useRelayStore((s) => s.readArtifact)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isHtml = /\.html?$/i.test(relPath)

  useEffect(() => {
    let alive = true
    void (async () => {
      setLoading(true)
      try {
        const r = await readArtifact(sessionId, relPath)
        if (!alive) return
        if (!r) setError("读取失败，请确认桌面端在线")
        else setContent(r.content)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [sessionId, relPath, readArtifact])

  const mdStyles = useMemo(
    () =>
      ({
        body: { color: t.textSecondary, fontSize: 14.5, lineHeight: 22 },
        strong: { color: t.text, fontWeight: "700" },
        heading1: { color: t.text, fontSize: 19, fontWeight: "700", marginTop: 8, marginBottom: 6 },
        heading2: { color: t.text, fontSize: 17, fontWeight: "700", marginTop: 8, marginBottom: 4 },
        heading3: { color: t.text, fontSize: 15.5, fontWeight: "600", marginTop: 6, marginBottom: 3 },
        link: { color: t.accent },
        code_inline: { color: "#fbbf24", backgroundColor: "rgba(251,191,36,0.10)", fontFamily: "Menlo", fontSize: 13 },
        fence: { backgroundColor: t.card, borderRadius: 8, borderWidth: 1, borderColor: t.border, color: t.textSecondary, fontFamily: "Menlo", fontSize: 12.5 },
        blockquote: { backgroundColor: t.accentSoft, borderLeftColor: t.accent, borderLeftWidth: 3 },
        hr: { backgroundColor: t.border },
      }) as const,
    [t]
  )

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: t.bg },
        center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
        hint: { color: t.textMuted, fontSize: 13, textAlign: "center" },
        scroll: { padding: 16, paddingBottom: 32 },
        webview: { flex: 1, backgroundColor: t.bg },
      }),
    [t]
  )

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={t.accent} />
      </View>
    )
  }

  if (error || content == null) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>{error ?? "文件过大或为空，无法预览"}</Text>
        <Text style={styles.hint}>{name}</Text>
      </View>
    )
  }

  if (isHtml) {
    return (
      <WebView
        style={styles.webview}
        originWhitelist={["*"]}
        source={{ html: content }}
        // 深色主题下给页面一个基础底色，避免白底刺眼
        injectedJavaScript={`document.documentElement.style.background='${t.bg}';true;`}
      />
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <Markdown style={mdStyles}>{content}</Markdown>
    </ScrollView>
  )
}
