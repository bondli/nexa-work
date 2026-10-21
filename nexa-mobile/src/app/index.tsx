import { Redirect } from "expo-router"
import { useEffect, useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { storage } from "@/lib/relay/storage"
import { useResolvedTheme } from "@/lib/theme"

export default function Index() {
  const theme = useResolvedTheme()
  const [ready, setReady] = useState(false)
  const [hasToken, setHasToken] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      const token = await storage.getToken()
      const url = await storage.getRelayUrl()
      if (active) {
        setHasToken(!!token && !!url)
        setReady(true)
      }
    })()
    return () => { active = false }
  }, [])

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.bg }}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    )
  }

  return <Redirect href={hasToken ? "/(tabs)" : "/pair"} />
}
