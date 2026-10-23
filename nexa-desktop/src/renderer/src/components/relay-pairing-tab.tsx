/**
 * 设置对话框 · 手机配对 Tab (M5b)
 * - 中继服务器地址配置与连接状态
 * - 生成 6 位配对码 + 二维码（手机端扫码或手输）
 * - 已配对设备列表（在线状态 / 解绑）
 */
import { useCallback, useEffect, useRef, useState } from "react"
import QRCode from "qrcode"
import { Smartphone, Wifi, WifiOff, Loader2, RefreshCw, Copy, Trash2, Check, ShieldAlert, Pencil } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@renderer/components/ui/dialog"
import { cn } from "@renderer/lib/utils"
import type { PairedDevice, RelayStatus } from "@shared/ipc-channels"

/** 配对二维码 deep link 内容（M5c RN 客户端解析） */
function pairingDeepLink(relayUrl: string, code: string): string {
  return `nexa://pair?url=${encodeURIComponent(relayUrl)}&code=${code}`
}

/**
 * 配对码剩余有效时间
 * 倒计时必须独立成组件：若把计时器放在 RelayPairingTab 里，整页每 500ms 重渲染一次，
 * 会连带中继地址输入框一起重渲染，输入时表现为输入框闪烁。
 */
function PairingCountdown({ expiresAt }: { expiresAt: number }) {
  const calc = () => Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))
  const [remain, setRemain] = useState(calc)

  useEffect(() => {
    setRemain(calc())
    const timer = setInterval(() => setRemain(calc()), 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt])

  return (
    <>
      {Math.floor(remain / 60)}:{String(remain % 60).padStart(2, "0")} 后失效
    </>
  )
}

/** 非本机地址的明文 HTTP 视为不安全（生产环境应使用 HTTPS / wss） */
function isInsecureHttp(url: string): boolean {
  try {
    const parsed = new URL(url)
    const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "0.0.0.0"
    return parsed.protocol === "http:" && !isLocal
  } catch {
    return false
  }
}

export function RelayPairingTab() {
  const [status, setStatus] = useState<RelayStatus | null>(null)
  const [urlDraft, setUrlDraft] = useState("")
  const [savingUrl, setSavingUrl] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  /** 待安全确认的明文 HTTP 地址（非本机地址时需用户确认后才连接） */
  const [pendingInsecureUrl, setPendingInsecureUrl] = useState<string | null>(null)
  const [confirmingUrl, setConfirmingUrl] = useState(false)
  /** 待解绑设备（null 表示确认弹框关闭） */
  const [pendingUnbind, setPendingUnbind] = useState<PairedDevice | null>(null)
  const [unbinding, setUnbinding] = useState(false)
  /** 待改名设备（null 表示改名弹框关闭） */
  const [renaming, setRenaming] = useState<PairedDevice | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const [renamingBusy, setRenamingBusy] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [pairError, setPairError] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const subscribedRef = useRef(false)

  const refresh = useCallback(async () => {
    const s = (await window.nexa.relayStatus()) as RelayStatus | null
    setStatus(s)
    setUrlDraft((prev) => (document.activeElement?.getAttribute("data-relay-input") ? prev : s?.relayUrl ?? ""))
    return s
  }, [])

  useEffect(() => {
    void refresh()
    if (!subscribedRef.current) {
      subscribedRef.current = true
      const unsub = window.nexa.onRelayEvent((s: RelayStatus) => {
        setStatus(s)
        setUrlDraft((prev) => (document.activeElement?.getAttribute("data-relay-input") ? prev : s.relayUrl))
      })
      return () => {
        unsub()
        subscribedRef.current = false
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 配对码过期后清掉二维码（倒计时由 PairingCountdown 自行驱动，不触发本组件重渲染）
  useEffect(() => {
    if (!status?.pendingPairing) setQrDataUrl(null)
  }, [status?.pendingPairing])

  // 生成二维码
  useEffect(() => {
    if (!status?.pendingPairing || !status.relayUrl) {
      setQrDataUrl(null)
      return
    }
    const link = pairingDeepLink(status.relayUrl, status.pendingPairing.code)
    void QRCode.toDataURL(link, { width: 160, margin: 1 }).then(setQrDataUrl).catch(() => setQrDataUrl(null))
  }, [status?.pendingPairing?.code, status?.relayUrl])

  /** 保存地址并重连（安全校验已通过时调用） */
  const applyUrl = async (url: string) => {
    await window.nexa.relaySetUrl(url)
    await refresh()
  }

  const handleSaveUrl = async () => {
    setSavingUrl(true)
    setUrlError(null)
    try {
      const url = urlDraft.trim()
      new URL(url) // 格式校验，非法地址直接进 catch
      // 非本机明文 HTTP：先弹框二次确认，确认后由 confirmInsecureUrl 继续
      if (isInsecureHttp(url)) {
        setPendingInsecureUrl(url)
        return
      }
      await applyUrl(url)
    } catch (e) {
      setUrlError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingUrl(false)
    }
  }

  /** 安全警告弹框中确认「仍然继续」 */
  const confirmInsecureUrl = async () => {
    const url = pendingInsecureUrl
    if (!url) return
    setConfirmingUrl(true)
    setUrlError(null)
    try {
      await applyUrl(url)
      setPendingInsecureUrl(null)
    } catch (e) {
      setUrlError(e instanceof Error ? e.message : String(e))
      setPendingInsecureUrl(null)
    } finally {
      setConfirmingUrl(false)
    }
  }

  const handleCreatePairing = async () => {
    setCreating(true)
    setPairError(null)
    try {
      await window.nexa.relayCreatePairing()
    } catch (e) {
      setPairError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  /** 确认解绑（relayClient.unbind 会 emit 状态，列表随之自动刷新） */
  const confirmUnbind = async () => {
    if (!pendingUnbind) return
    setUnbinding(true)
    try {
      await window.nexa.relayUnbind(pendingUnbind.deviceId)
      setPendingUnbind(null)
    } finally {
      setUnbinding(false)
    }
  }

  /** 打开改名弹框，草稿预填当前名字 */
  const openRename = (device: PairedDevice) => {
    setRenaming(device)
    setRenameDraft(device.name)
    setRenameError(null)
  }

  const confirmRename = async () => {
    if (!renaming) return
    const name = renameDraft.trim()
    if (!name) {
      setRenameError("请输入设备名称")
      return
    }
    setRenamingBusy(true)
    try {
      await window.nexa.relayRename(renaming.deviceId, name)
      setRenaming(null)
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "改名失败")
    } finally {
      setRenamingBusy(false)
    }
  }

  const handleCopy = async () => {
    if (!status?.pendingPairing) return
    await navigator.clipboard.writeText(status.pendingPairing.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const connected = status?.connected ?? false
  /** 当前已保存的中继地址是否为非本机明文 HTTP（常驻安全提示，切到 HTTPS 会自动消失） */
  const insecureRelay = isInsecureHttp(status?.relayUrl ?? "")
  const pending = status?.pendingPairing ?? null
  const paired = status?.paired ?? []

  return (
    <div>
      {/* 中继地址 */}
      <div className="mb-5">
        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Smartphone className="h-3 w-3" />
          中继服务器
        </label>
        <div className="flex items-center gap-2">
          <input
            data-relay-input="1"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="http://127.0.0.1:8787（本地测试）或 https://relay.example.com"
            className="flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm font-mono outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5 text-xs" disabled={savingUrl} onClick={() => void handleSaveUrl()}>
            {savingUrl ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            保存并连接
          </Button>
        </div>
        {urlError && <p className="mt-1.5 text-xs text-destructive">{urlError}</p>}
        {insecureRelay && (
          <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
            <ShieldAlert className="h-3 w-3 shrink-0" />
            当前中继地址使用未加密 HTTP，生产环境建议改用 HTTPS 以防配对码与通信内容被截获。
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium",
              connected ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"
            )}
          >
            {connected ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
            {connected ? "已连接" : status?.relayUrl ? "连接中/已断开（自动重连）" : "未配置"}
          </span>
          {status?.lastError && !connected && (
            <span className="text-[10px] text-destructive">{status.lastError}</span>
          )}
          <button
            onClick={() => void refresh()}
            className="ml-auto flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw className="h-2.5 w-2.5" />
            刷新状态
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          本机设备 ID：<code className="font-mono">{status?.deviceId ?? "—"}</code>
        </p>
      </div>

      {/* 配对 */}
      <div className="mb-5 rounded-xl border border-border bg-background p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">配对新手机</h3>
          <Button size="sm" className="h-7 gap-1.5 text-xs" disabled={!connected || creating} onClick={() => void handleCreatePairing()}>
            {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Smartphone className="h-3 w-3" />}
            生成配对码
          </Button>
        </div>
        <p className="mb-3 text-[11px] text-muted-foreground">
          配对码 10 分钟内一次性有效。在手机 Nexa App 中扫码或手动输入即可完成配对。
        </p>
        {pairError && <p className="mb-2 text-xs text-destructive">{pairError}</p>}
        {!connected && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            请先保存并连接中继服务器，再生成配对码。
          </p>
        )}
        {connected && pending && (
          <div className="flex items-start gap-4">
            <div className="flex flex-col items-center gap-1">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="配对二维码" className="h-36 w-36 rounded-lg border border-border bg-white p-1" />
              ) : (
                <div className="flex h-36 w-36 items-center justify-center rounded-lg border border-border bg-muted">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-muted-foreground">配对码</div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-2xl font-bold tracking-[0.3em]">{pending.code}</span>
                <button
                  onClick={() => void handleCopy()}
                  title="复制配对码"
                  className="rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                <PairingCountdown expiresAt={pending.expiresAt} />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                手机与电脑需连接同一个中继服务器。配对成功后此处会出现设备，可随时解绑。
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 已配对设备 */}
      <div>
        <h3 className="mb-2 text-sm font-medium">已配对设备（{paired.length}）</h3>
        {paired.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            还没有配对的手机
          </p>
        ) : (
          <div className="space-y-2">
            {paired.map((d) => (
              <div key={d.deviceId} className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Smartphone className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{d.name}</span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]",
                        d.online ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", d.online ? "bg-emerald-500" : "bg-muted-foreground")} />
                      {d.online ? "在线" : "离线"}
                    </span>
                  </div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">{d.deviceId}</div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground"
                  title="重命名"
                  aria-label="重命名设备"
                  onClick={() => openRename(d)}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 gap-1 text-xs text-destructive hover:bg-destructive/5 hover:text-destructive"
                  onClick={() => setPendingUnbind(d)}
                >
                  <Trash2 className="h-3 w-3" />
                  解绑
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 安全警告确认弹框（替代 window.confirm） */}
      <Dialog
        open={!!pendingInsecureUrl}
        onOpenChange={(open) => {
          if (!open && !confirmingUrl) setPendingInsecureUrl(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" />
              安全警告
            </DialogTitle>
            <DialogDescription>当前使用的是未加密的 HTTP 中继地址。</DialogDescription>
          </DialogHeader>

          <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
            <li>公共网络中，配对码与通信内容可能被第三方截获。</li>
            <li>
              生产环境建议使用 HTTPS（如 <code className="font-mono">https://relay.example.com</code>），连接会自动升级为 wss。
            </li>
            <li>仅在可信内网或本机调试时使用明文 HTTP。</li>
          </ul>

          <div className="break-all rounded-md bg-muted px-3 py-2 font-mono text-[11px] text-muted-foreground">
            {pendingInsecureUrl}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingInsecureUrl(null)} disabled={confirmingUrl}>
              取消
            </Button>
            <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => void confirmInsecureUrl()} disabled={confirmingUrl}>
              {confirmingUrl ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5" />}
              仍然继续
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 改名弹框 */}
      <Dialog
        open={!!renaming}
        onOpenChange={(open) => {
          if (!open && !renamingBusy) setRenaming(null)
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名设备</DialogTitle>
            <DialogDescription>
              名称只保存在本机，用于区分多台手机，不影响手机端显示。
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={renameDraft}
            maxLength={32}
            placeholder="输入设备名称"
            onChange={(e) => {
              setRenameDraft(e.target.value)
              if (renameError) setRenameError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) void confirmRename()
            }}
          />
          {renameError && <p className="text-xs text-destructive">{renameError}</p>}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRenaming(null)} disabled={renamingBusy}>
              取消
            </Button>
            <Button size="sm" onClick={() => void confirmRename()} disabled={renamingBusy}>
              {renamingBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 解绑确认弹框 */}
      <Dialog
        open={!!pendingUnbind}
        onOpenChange={(open) => {
          if (!open && !unbinding) setPendingUnbind(null)
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>解绑这台设备？</DialogTitle>
            <DialogDescription className="break-words">
              {pendingUnbind ? `「${pendingUnbind.name}」解绑后将无法再通过中继与桌面端通信，需要重新配对。` : "解绑后需要重新配对。"}
            </DialogDescription>
          </DialogHeader>
          {pendingUnbind && (
            <div className="break-all rounded-md bg-muted px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {pendingUnbind.deviceId}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingUnbind(null)} disabled={unbinding}>
              取消
            </Button>
            <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => void confirmUnbind()} disabled={unbinding}>
              {unbinding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              解绑
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
