/**
 * 应用内确认弹框（替代系统 Alert）
 * - 主题化圆角卡片、半透明遮罩，点击遮罩/取消关闭
 * - 仅用于「取消 / 确认」这类轻量二次确认，不承载表单
 */
import { useMemo } from "react"
import { Modal, Pressable, StyleSheet, Text, View } from "react-native"
import { useTheme } from "@/lib/theme"

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmText = "确定",
  cancelText = "取消",
  destructive,
  loading,
  onConfirm,
  onCancel,
}: {
  visible: boolean
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  /** 危险操作（解绑/删除）：确认按钮用错误色 */
  destructive?: boolean
  /** 确认中：禁用两个按钮，避免重复提交 */
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { colors: t } = useTheme()

  const s = useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.45)",
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 32,
        },
        card: {
          width: "100%",
          maxWidth: 340,
          borderRadius: 16,
          backgroundColor: t.card,
          overflow: "hidden",
        },
        body: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 20, gap: 8 },
        title: { color: t.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
        message: { color: t.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center" },
        btnRow: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
        btn: { flex: 1, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
        btnDivider: { width: StyleSheet.hairlineWidth, backgroundColor: t.border },
        cancelText: { color: t.textSecondary, fontSize: 16 },
        confirmText: { color: t.accent, fontSize: 16, fontWeight: "600" },
        confirmDanger: { color: t.danger },
        disabled: { opacity: 0.5 },
      }),
    [t]
  )

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      {/* 外层点击遮罩关闭；内层拦截点击避免误关 */}
      <Pressable style={s.backdrop} onPress={onCancel} accessibilityLabel="关闭弹框">
        <Pressable style={s.card} onPress={() => {}}>
          <View style={s.body}>
            <Text style={s.title}>{title}</Text>
            {message ? <Text style={s.message}>{message}</Text> : null}
          </View>
          <View style={s.btnRow}>
            <Pressable
              style={[s.btn, loading && s.disabled]}
              onPress={onCancel}
              disabled={loading}
              android_ripple={{ color: "transparent" }}
              accessibilityLabel={cancelText}
            >
              <Text style={s.cancelText}>{cancelText}</Text>
            </Pressable>
            <View style={s.btnDivider} />
            <Pressable
              style={[s.btn, loading && s.disabled]}
              onPress={onConfirm}
              disabled={loading}
              android_ripple={{ color: "transparent" }}
              accessibilityLabel={confirmText}
            >
              <Text style={[s.confirmText, destructive && s.confirmDanger]}>{confirmText}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}
