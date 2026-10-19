import { Stack } from "expo-router"
import { useEffect } from "react"
import { initRelayService } from "@/lib/relay/service"

export default function RootLayout() {
  useEffect(() => {
    void initRelayService()
  }, [])

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#0a0a0a" },
        headerTintColor: "#fafafa",
        headerTitleStyle: { fontWeight: "600" },
        contentStyle: { backgroundColor: "#0a0a0a" },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="pair" options={{ title: "配对电脑" }} />
      <Stack.Screen name="home" options={{ title: "Nexa" }} />
      <Stack.Screen name="library" options={{ title: "资料库" }} />
      <Stack.Screen name="session/[id]" options={{ title: "会话" }} />
    </Stack>
  )
}
