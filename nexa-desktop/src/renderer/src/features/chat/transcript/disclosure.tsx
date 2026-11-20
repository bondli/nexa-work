/**
 * 统一折叠/展开系统，借鉴 PI-Desktop 的 useAutomaticDisclosure：
 *  - 默认由 isInitiallyOpen 决定（active turn 默认展开、settled 默认收拢）；
 *  - 用户手动切换后以 key 记住（会话内），用户选择优先于默认；
 *  - DisclosureScope：父 disclosure 关闭时子级跟随收拢，父重新打开恢复子级自身选择。
 *
 * 会话级记忆用模块内 Map，刷新会话即重建，无需持久化（偏好才持久化到 transcript-prefs）。
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react"

/** 会话级用户手动展开/收拢记忆（key → 是否展开） */
const userChoices = new Map<string, boolean>()

/** 切换会话时清空记忆，避免跨会话串扰 */
export function clearUserDisclosureChoices() {
  userChoices.clear()
}

interface DisclosureScopeValue {
  /** 父级是否处于展开态；false 时子级应收拢跟随 */
  scopeOpen: boolean
}
const DisclosureScopeContext = createContext<DisclosureScopeValue>({ scopeOpen: true })

export function useDisclosureScope(): boolean {
  return useContext(DisclosureScopeContext).scopeOpen
}

export function DisclosureScopeProvider({ open, children }: { open: boolean; children: React.ReactNode }) {
  const value = useMemo(() => ({ scopeOpen: open }), [open])
  return <DisclosureScopeContext.Provider value={value}>{children}</DisclosureScopeContext.Provider>
}

interface UseDisclosureArgs {
  key: string
  initiallyOpen: boolean
  /** 外部强制展开请求（仅当用户未手动选择时生效） */
  revealRequest?: boolean
}

export interface DisclosureApi {
  /** 自身是否展开（不考虑父作用域） */
  open: boolean
  /** 考虑父级作用域后的实际可见展开态 */
  visibleOpen: boolean
  toggle: () => void
  setOpen: (open: boolean) => void
}

export function useAutomaticDisclosure({ key, initiallyOpen, revealRequest }: UseDisclosureArgs): DisclosureApi {
  const [userOpen, setUserOpen] = useState<boolean | null>(() =>
    userChoices.has(key) ? (userChoices.get(key) as boolean) : null,
  )

  // 用户未手动选择时，跟随默认/外部请求；用户选择后以用户为准
  const open = userOpen ?? (revealRequest ? true : initiallyOpen)
  const scopeOpen = useDisclosureScope()
  // 父级关闭时子级视觉收拢，但自身 open 不变 → 父重开后恢复子级上次选择
  const visibleOpen = scopeOpen && open

  const toggle = useCallback(() => {
    const next = !open
    userChoices.set(key, next)
    setUserOpen(next)
  }, [key, open])

  const setOpen = useCallback(
    (value: boolean) => {
      userChoices.set(key, value)
      setUserOpen(value)
    },
    [key],
  )

  return { open, visibleOpen, toggle, setOpen }
}
