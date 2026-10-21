/**
 * 全屏图片查看器：
 * - 点击图片打开；点击图片外的空白区域或右上角 X 关闭
 * - 双指捏合缩放（1–4x）、双击放大/复位、放大后单指拖动
 * - 说明：用 RN 原生 onTouchStart/Move/End（而非 PanResponder）实现多指手势，
 *   避免被外层 ScrollView 抢走 responder 导致双指无效；不引入 gesture-handler / reanimated。
 */
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Animated,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { X } from "lucide-react-native"

const MAX_SCALE = 4
const DOUBLE_TAP_SCALE = 2.2
/** 双击判定窗口（ms） */
const DOUBLE_TAP_MS = 260
/** 超过该位移视为拖动而非点击（px） */
const TAP_SLOP = 10

/** 两指间距（缩放比例的分母） */
function touchDistance(touches: readonly { pageX: number; pageY: number }[]): number {
  if (touches.length < 2) return 0
  return Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY)
}

export function ImageViewer({
  uri,
  visible,
  onClose,
}: {
  /** 图片地址（dataUrl 或 uri），为空时不渲染内容 */
  uri: string | null
  visible: boolean
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const scale = useRef(new Animated.Value(1)).current
  const translateX = useRef(new Animated.Value(0)).current
  const translateY = useRef(new Animated.Value(0)).current
  // Animated.Value 读取不便，这里用 ref 同步记录当前值供手势计算
  const scaleRef = useRef(1)
  const txRef = useRef(0)
  const tyRef = useRef(0)
  /** 图片原始尺寸（用于计算 contain 后的实际显示区域，判断点击是否落在空白处） */
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)

  const gestures = useRef({
    startX: 0,
    startY: 0,
    startAt: 0,
    moved: false,
    pinchStartDist: 0,
    pinchStartScale: 1,
    pinched: false,
    panStartX: 0,
    panStartY: 0,
    lastTapAt: 0,
  })

  const animateTo = (targetScale: number, x = 0, y = 0) => {
    scaleRef.current = targetScale
    txRef.current = x
    tyRef.current = y
    Animated.parallel([
      Animated.timing(scale, { toValue: targetScale, duration: 160, useNativeDriver: false }),
      Animated.timing(translateX, { toValue: x, duration: 160, useNativeDriver: false }),
      Animated.timing(translateY, { toValue: y, duration: 160, useNativeDriver: false }),
    ]).start()
  }

  // 关闭时复位，下次打开从原始比例开始
  useEffect(() => {
    if (!visible) animateTo(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  // 取原图尺寸（dataUrl 已在内存中，getSize 基本是同步的）
  useEffect(() => {
    if (!uri) {
      setNatural(null)
      return
    }
    Image.getSize(
      uri,
      (w, h) => setNatural(w > 0 && h > 0 ? { w, h } : null),
      () => setNatural(null)
    )
  }, [uri])

  /** 图片在 contain 模式下实际占据的屏幕区域 */
  const displayRect = useMemo(() => {
    if (!natural) return null
    const s = Math.min(width / natural.w, height / natural.h)
    const w = natural.w * s
    const h = natural.h * s
    return { left: (width - w) / 2, top: (height - h) / 2, right: (width + w) / 2, bottom: (height + h) / 2 }
  }, [natural, width, height])

  const handleTouchStart = (e: GestureResponderEvent) => {
    const touches = e.nativeEvent.touches
    const g = gestures.current
    if (touches.length >= 2) {
      // 第二根手指落下：重置捏合基准
      g.pinched = true
      g.pinchStartDist = touchDistance(touches)
      g.pinchStartScale = scaleRef.current
      return
    }
    if (touches.length === 1) {
      g.startX = touches[0].pageX
      g.startY = touches[0].pageY
      g.startAt = Date.now()
      g.moved = false
      g.pinched = false
      g.pinchStartDist = 0
      g.panStartX = txRef.current
      g.panStartY = tyRef.current
    }
  }

  const handleTouchMove = (e: GestureResponderEvent) => {
    const touches = e.nativeEvent.touches
    const g = gestures.current

    if (touches.length >= 2) {
      const dist = touchDistance(touches)
      if (!g.pinchStartDist) {
        g.pinchStartDist = dist
        g.pinchStartScale = scaleRef.current
        return
      }
      g.pinched = true
      const next = Math.min(MAX_SCALE, Math.max(1, (g.pinchStartScale * dist) / g.pinchStartDist))
      scaleRef.current = next
      scale.setValue(next)
      return
    }

    if (touches.length !== 1) return
    const dx = touches[0].pageX - g.startX
    const dy = touches[0].pageY - g.startY
    if (Math.hypot(dx, dy) > TAP_SLOP) g.moved = true
    if (scaleRef.current <= 1 || !g.moved) return
    // 放大后单指拖动查看细节，位移限制在放大后的边界内
    const maxX = (width * (scaleRef.current - 1)) / 2
    const maxY = (height * (scaleRef.current - 1)) / 2
    txRef.current = Math.max(-maxX, Math.min(maxX, g.panStartX + dx))
    tyRef.current = Math.max(-maxY, Math.min(maxY, g.panStartY + dy))
    translateX.setValue(txRef.current)
    translateY.setValue(tyRef.current)
  }

  const handleTouchEnd = (e: GestureResponderEvent) => {
    // 还有手指没抬起（如双指先后抬起）→ 等全部抬起再判定
    if (e.nativeEvent.touches.length > 0) return
    const g = gestures.current

    if (scaleRef.current <= 1.02) animateTo(1)
    if (g.pinched) {
      g.pinched = false
      return
    }
    if (g.moved || Date.now() - g.startAt > 400) return

    // 双击：放大 / 复位
    const now = Date.now()
    const isDoubleTap = now - g.lastTapAt < DOUBLE_TAP_MS
    g.lastTapAt = isDoubleTap ? 0 : now
    if (isDoubleTap) {
      animateTo(scaleRef.current > 1.05 ? 1 : DOUBLE_TAP_SCALE)
      return
    }

    // 单击：点在图片以外的空白区域 → 关闭预览
    if (scaleRef.current > 1.02) return
    const point = e.nativeEvent.changedTouches?.[0]
    const x = point?.pageX ?? g.startX
    const y = point?.pageY ?? g.startY
    if (displayRect && (x < displayRect.left || x > displayRect.right || y < displayRect.top || y > displayRect.bottom)) {
      onClose()
    }
  }

  const s = useMemo(
    () =>
      StyleSheet.create({
        root: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)" },
        image: { width: "100%", height: "100%" },
        close: {
          position: "absolute",
          right: 16,
          zIndex: 2,
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(255,255,255,0.14)",
        },
        hint: {
          position: "absolute",
          left: 0,
          right: 0,
          textAlign: "center",
          color: "rgba(255,255,255,0.55)",
          fontSize: 12,
        },
      }),
    []
  )

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View
        style={s.root}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {uri ? (
          <Animated.Image
            source={{ uri }}
            style={[s.image, { transform: [{ translateX }, { translateY }, { scale }] }]}
            resizeMode="contain"
          />
        ) : null}
        <Pressable
          style={[s.close, { top: insets.top + 8 }]}
          onPress={onClose}
          hitSlop={12}
          accessibilityLabel="关闭大图"
        >
          <X size={22} color="#fff" />
        </Pressable>
        <Text style={[s.hint, { bottom: insets.bottom + 16 }]}>双指缩放 · 双击放大 · 点击空白处关闭</Text>
      </View>
    </Modal>
  )
}
