import { Stack, router } from "expo-router"
import { useEffect } from "react"
import { Pressable, View } from "react-native"
import { StatusBar } from "expo-status-bar"
import { NavigationBar } from "expo-navigation-bar"
import * as SystemUI from "expo-system-ui"
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context"
import { ChevronLeft } from "lucide-react-native"
import { initRelayService } from "@/lib/relay/service"
import { ThemeContext, initChatFontSize, initThemeMode, useResolvedTheme } from "@/lib/theme"
import { configureNotificationHandler, setupNotificationChannels } from "@/lib/push"

export default function RootLayout() {
  // 显式提供 SafeAreaProvider：底部手势条区域补底色需要读取 inset
  return (
    <SafeAreaProvider>
      <RootLayoutContent />
    </SafeAreaProvider>
  )
}

function RootLayoutContent() {
  const theme = useResolvedTheme()
  const insets = useSafeAreaInsets()

  useEffect(() => {
    // 通知处理器要在任何通知到达前注册（前台展示策略）
    configureNotificationHandler()
    void setupNotificationChannels()
    void initRelayService()
    void initThemeMode()
    void initChatFontSize()
  }, [])

  // 根视图（窗口）底色跟随主题：部分厂商 ROM（如华为手势导航条）该区域由窗口绘制，
  // 且 Android 导航栏对比度遮罩会忽略 App 主题，必须同时把根视图底色改成主题色
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.colors.bg).catch(() => {})
  }, [theme.colors.bg])

  return (
    <ThemeContext.Provider value={theme}>
      {/* 顶部状态栏（电池/时间）图标颜色：深色主题用 light，浅色主题用 dark */}
      <StatusBar style={theme.isDark ? "light" : "dark"} />
      {/* Android 底部导航栏图标颜色（手势指示条区底色由下方根视图 + 底部补色块负责） */}
      <NavigationBar style={theme.isDark ? "dark" : "light"} />
      <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        {/* 手势指示条区域补主题底色：edge-to-edge 下该条带是系统透明叠加层，
            不铺底色会透出窗口白底（深色模式尤其明显；关闭手势提示条后 inset 为 0 自然不渲染）。
            注意必须画在 Stack 之前的底层，否则会盖住页面底部固定的输入框等内容 */}
        {insets.bottom > 0 ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: insets.bottom,
              backgroundColor: theme.colors.bg,
            }}
          />
        ) : null}
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.colors.bg },
            headerTintColor: theme.colors.text,
            headerTitleStyle: { fontWeight: "600", fontSize: 17 },
            contentStyle: { backgroundColor: theme.colors.bg },
            // 切入动效：Android 上 react-native-screens 的默认动画是「缩小 0.85 → 1 + 淡入」，
            // 观感是页面闪一下出现；统一改成从右侧推入的标准页面切入
            animation: "slide_from_right",
            // 自定义返回按钮：去掉 Android 原生头部返回键的水波纹/暗色闪动
            headerBackVisible: false,
            headerLeft: () => (
              <Pressable
                onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))}
                hitSlop={12}
                android_ripple={{ color: "transparent" }}
                style={{ paddingHorizontal: 8, paddingVertical: 6 }}
                accessibilityLabel="返回"
              >
                <ChevronLeft size={24} color={theme.colors.text} />
              </Pressable>
            ),
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="pair" options={{ title: "配对电脑" }} />
          <Stack.Screen name="desktop-switch" options={{ title: "切换电脑", presentation: "modal", animation: "slide_from_bottom" }} />
          <Stack.Screen name="session/[id]" options={{ title: "任务详情" }} />
          <Stack.Screen name="new-task" options={{ title: "新建任务", presentation: "modal", animation: "slide_from_bottom" }} />
          <Stack.Screen name="new-note" options={{ title: "新增笔记", presentation: "modal", animation: "slide_from_bottom" }} />
          <Stack.Screen name="artifact/[sessionId]" options={{ title: "产物预览" }} />
          <Stack.Screen name="job/[jobId]" options={{ title: "执行记录" }} />
          <Stack.Screen name="library/[id]" options={{ title: "资料详情" }} />
        </Stack>
      </View>
    </ThemeContext.Provider>
  )
}
