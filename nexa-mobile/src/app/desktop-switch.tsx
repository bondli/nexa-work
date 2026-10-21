/**
 * 切换电脑（modal）：列出所有配对记录，点击切换当前操作的电脑；入口添加新电脑
 */
import { useMemo } from "react"
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import { router } from "expo-router"
import { Check, Monitor, Plus, X } from "lucide-react-native"
import { useTheme } from "@/lib/theme"
import { useRelayStore } from "@/lib/relay/service"

export default function DesktopSwitchScreen() {
  const { colors: t } = useTheme()
  const pairings = useRelayStore((s) => s.pairings)
  const currentDesktopId = useRelayStore((s) => s.currentDesktopId)
  const switchDesktop = useRelayStore((s) => s.switchDesktop)
  const unbindDesktop = useRelayStore((s) => s.unbindDesktop)

  const handleSwitch = (desktopId: string) => {
    if (desktopId === currentDesktopId) {
      router.back()
      return
    }
    void switchDesktop(desktopId)
      .then(() => router.back())
      .catch((e) => Alert.alert("切换失败", e instanceof Error ? e.message : String(e)))
  }

  const handleUnbind = (desktopId: string, name: string) => {
    Alert.alert(`解绑「${name}」`, "解绑后需要重新配对才能再次连接这台电脑", [
      { text: "取消", style: "cancel" },
      {
        text: "解绑",
        style: "destructive",
        onPress: () => {
          void unbindDesktop(desktopId).then((wasCurrent) => {
            if (wasCurrent) router.replace("/pair")
          })
        },
      },
    ])
  }

  // 样式随主题重建（亮/暗切换时自动生效）
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: t.bg },
        content: { padding: 16, paddingBottom: 40, gap: 10 },
        hint: { color: t.textMuted, fontSize: 13, lineHeight: 20, marginBottom: 6 },
        empty: { color: t.textMuted, fontSize: 14, textAlign: "center", padding: 24 },
        card: {
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: t.card,
          borderRadius: 12,
          padding: 14,
          gap: 8,
        },
        cardCurrent: { borderWidth: 1, borderColor: t.accent },
        cardMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
        cardText: { flex: 1, gap: 2 },
        name: { color: t.text, fontSize: 15, fontWeight: "500" },
        nameCurrent: { color: t.accent },
        id: { color: t.textMuted, fontSize: 11, fontFamily: "Menlo" },
        addBtn: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          borderRadius: 12,
          paddingVertical: 13,
          backgroundColor: t.accentSoft,
          marginTop: 8,
        },
        addText: { color: t.accent, fontSize: 14, fontWeight: "600" },
      }),
    [t]
  )

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.hint}>可在多台电脑上分别生成配对码，将它们都添加到这里；点击切换当前操作的电脑。</Text>

      {pairings.length === 0 ? <Text style={styles.empty}>还没有配对记录</Text> : null}

      {pairings.map((p) => {
        const isCurrent = p.desktopId === currentDesktopId
        return (
          <View key={p.desktopId} style={[styles.card, isCurrent && styles.cardCurrent]}>
            <Pressable style={styles.cardMain} onPress={() => handleSwitch(p.desktopId)}>
              <Monitor size={18} color={isCurrent ? t.accent : t.textMuted} />
              <View style={styles.cardText}>
                <Text style={[styles.name, isCurrent && styles.nameCurrent]} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={styles.id} numberOfLines={1}>{p.desktopId}</Text>
              </View>
              {isCurrent ? <Check size={18} color={t.accent} /> : null}
            </Pressable>
            <Pressable hitSlop={8} onPress={() => handleUnbind(p.desktopId, p.name)} accessibilityLabel="解绑">
              <X size={18} color={t.textMuted} />
            </Pressable>
          </View>
        )
      })}

      <Pressable style={styles.addBtn} onPress={() => router.replace("/pair")}>
        <Plus size={18} color={t.accent} />
        <Text style={styles.addText}>添加新电脑</Text>
      </Pressable>
    </ScrollView>
  )
}
