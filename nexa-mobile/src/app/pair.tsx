import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { useRouter } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { CameraView, useCameraPermissions } from "expo-camera"
import { startRelayWithPairing, useRelayStore } from "@/lib/relay/service"
import { useTheme } from "@/lib/theme"

const CODE_RE = /^[A-Z0-9]{6}$/

/** 从二维码内容解析 relay url 与配对码 */
function parsePairPayload(raw: string): { url: string; code: string } | null {
  try {
    const u = new URL(raw)
    if (u.protocol === "nexa:") {
      const url = u.searchParams.get("url")
      const code = u.searchParams.get("code")
      if (url && code) return { url, code: code.toUpperCase() }
    }
  } catch { /* not a URL */ }
  // 兼容：扫码结果直接是配对码
  if (CODE_RE.test(raw.trim().toUpperCase())) return { url: "", code: raw.trim().toUpperCase() }
  return null
}

export default function PairScreen() {
  const router = useRouter()
  const { colors: t } = useTheme()
  const status = useRelayStore((s) => s.status)

  const [relayUrl, setRelayUrl] = useState("")
  const [code, setCode] = useState("")
  const [connecting, setConnecting] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [permission, requestPermission] = useCameraPermissions()

  // 配对成功后跳任务首页
  useEffect(() => {
    if (status.peerOnline && connecting) {
      setConnecting(false)
      router.replace("/(tabs)")
    }
  }, [status.peerOnline, connecting, router])

  const handleConnect = useCallback(async () => {
    const url = relayUrl.trim()
    const c = code.trim().toUpperCase()
    if (!url) { Alert.alert("请填写中继服务器地址"); return }
    if (!CODE_RE.test(c)) { Alert.alert("请输入 6 位配对码"); return }
    setConnecting(true)
    try {
      await startRelayWithPairing(url, c)
    } catch (e) {
      setConnecting(false)
      Alert.alert("配对失败", e instanceof Error ? e.message : String(e))
    }
  }, [relayUrl, code])

  // 样式随主题重建（亮/暗切换时自动生效）
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: t.bg, padding: 20, justifyContent: "center" },
        center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg, padding: 24 },
        card: { backgroundColor: t.card, borderRadius: 16, padding: 20 },
        title: { color: t.text, fontSize: 22, fontWeight: "700", marginBottom: 6 },
        subtitle: { color: t.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 20 },
        label: { color: t.text, fontSize: 13, fontWeight: "600", marginBottom: 6, marginTop: 4 },
        input: {
          backgroundColor: t.border, color: t.text, borderRadius: 10, paddingHorizontal: 14,
          paddingVertical: 12, fontSize: 15, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
        },
        codeRow: { flexDirection: "row", gap: 8, alignItems: "center" },
        codeInput: { flex: 1, letterSpacing: 6, textAlign: "center", fontSize: 20, height: 48 },
        // marginTop 归零覆盖 .btn 的 16px，固定 48px 高与输入框对齐
        scanBtn: { paddingHorizontal: 12, marginTop: 0, height: 48, width: 48 },
        btn: {
          backgroundColor: t.border, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16,
          alignItems: "center", justifyContent: "center", marginTop: 16, flexDirection: "row", gap: 8,
        },
        primary: { backgroundColor: t.accent },
        btnDisabled: { opacity: 0.6 },
        btnText: { color: t.text, fontSize: 15, fontWeight: "600" },
        // 主按钮（accent 底）文字恒为白色
        btnTextPrimary: { color: "#fff", fontSize: 15, fontWeight: "600" },
        linkText: { color: t.accent, fontSize: 14, marginTop: 12, textAlign: "center" },
        error: { color: t.danger, fontSize: 13, marginTop: 12 },
        muted: { color: t.textSecondary, fontSize: 14, marginBottom: 16, textAlign: "center" },
        // 相机取景器上的提示条保持深色遮罩（与主题无关）
        scanHint: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.7)", padding: 20, alignItems: "center" },
        scanHintText: { color: "#fafafa", fontSize: 14, marginBottom: 8 },
      }),
    [t]
  )

  const onBarcodeScanned = useCallback((result: { data: string }) => {
    const parsed = parsePairPayload(result.data)
    if (!parsed) { Alert.alert("无法识别的二维码"); return }
    setShowScanner(false)
    if (parsed.url) setRelayUrl(parsed.url)
    setCode(parsed.code)
  }, [])

  if (showScanner) {
    if (!permission?.granted) {
      return (
        <View style={styles.center}>
          <Text style={styles.muted}>需要相机权限来扫描二维码</Text>
          <Pressable style={styles.btn} onPress={requestPermission}>
            <Text style={styles.btnText}>授予权限</Text>
          </Pressable>
          <Pressable onPress={() => setShowScanner(false)} style={{ marginTop: 16 }}>
            <Text style={styles.linkText}>手动输入配对码</Text>
          </Pressable>
        </View>
      )
    }
    return (
      <View style={{ flex: 1 }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          onBarcodeScanned={onBarcodeScanned}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        />
        <View style={styles.scanHint}>
          <Text style={styles.scanHintText}>将桌面端「手机配对」二维码置于框内</Text>
          <Pressable onPress={() => setShowScanner(false)}>
            <Text style={styles.linkText}>取消</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>配对你的电脑</Text>
        <Text style={styles.subtitle}>
          在 Nexa 桌面端「设置 → 手机配对」生成配对码，填入下方即可建立连接
        </Text>

        <Text style={styles.label}>中继服务器地址</Text>
        <TextInput
          style={styles.input}
          value={relayUrl}
          onChangeText={setRelayUrl}
          placeholder="https://relay.example.com"
          placeholderTextColor={t.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <Text style={styles.label}>配对码</Text>
        <View style={styles.codeRow}>
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase().slice(0, 6))}
            placeholder="6 位码"
            placeholderTextColor={t.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          {/* 扫码入口：图标按钮，与输入框同高水平对齐 */}
          <Pressable
            style={[styles.btn, styles.scanBtn]}
            onPress={() => setShowScanner(true)}
            hitSlop={6}
          >
            <Ionicons name="scan-outline" size={22} color={t.text} />
          </Pressable>
        </View>

        {status.lastError && !connecting && (
          <Text style={styles.error}>{status.lastError}</Text>
        )}

        <Pressable
          style={[styles.btn, styles.primary, connecting && styles.btnDisabled]}
          onPress={handleConnect}
          disabled={connecting}
        >
          {connecting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[styles.btnText, styles.btnTextPrimary]}>连接</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  )
}

