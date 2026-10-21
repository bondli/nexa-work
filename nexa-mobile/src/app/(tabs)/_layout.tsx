/**
 * 底部 Tab 导航：任务 / 定时任务 / 资料库 / 我的
 * 图标使用 lucide-react-native（React Native 移植版，Expo Go 兼容）
 */
import type { ComponentProps } from "react"
import { Pressable } from "react-native"
import { router, Tabs } from "expo-router"
import { Clock, FolderOpen, ListTodo, Plus, Settings } from "lucide-react-native"
import { useTheme } from "@/lib/theme"

const TAB_ICON_SIZE = 22

/** 去掉 Android 点击 tab 时的水波纹/暗色闪动（默认 ripple 在深色主题下非常明显） */
function FlatTabButton(props: ComponentProps<typeof Pressable>) {
  return <Pressable {...props} android_ripple={{ color: "transparent" }} />
}

export default function TabsLayout() {
  // 主题配色：亮/暗随主题模式切换
  const { colors: t } = useTheme()
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.text,
        headerTitleStyle: { fontWeight: "600", fontSize: 17 },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: t.bg, borderTopColor: t.border },
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.textMuted,
        tabBarButton: (props) => <FlatTabButton {...(props as React.ComponentProps<typeof Pressable>)} />,
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "任务",
          tabBarIcon: ({ color }) => <ListTodo size={TAB_ICON_SIZE} color={color} />,
          // 任务页右上角 + 号：新建任务
          headerRight: () => (
            <Pressable onPress={() => router.push("/new-task")} hitSlop={10} style={{ marginRight: 14 }} accessibilityLabel="新建任务">
              <Plus size={24} color={t.text} />
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: "定时任务",
          tabBarIcon: ({ color }) => <Clock size={TAB_ICON_SIZE} color={color} />,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: "资料库",
          tabBarIcon: ({ color }) => <FolderOpen size={TAB_ICON_SIZE} color={color} />,
          // 右上角 + 号：新增笔记（文件 tab 下同样可用，统一入口）
          headerRight: () => (
            <Pressable onPress={() => router.push("/new-note")} hitSlop={10} style={{ marginRight: 14 }} accessibilityLabel="新增笔记">
              <Plus size={24} color={t.text} />
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "设置",
          tabBarIcon: ({ color }) => <Settings size={TAB_ICON_SIZE} color={color} />,
        }}
      />
    </Tabs>
  )
}
