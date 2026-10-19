/**
 * 首次启动引导向导 —— 对齐产品文档 §4.1 与 demo 原型
 * 3 步：基本信息（用户名）→ 模型配置（选模型+填API Key）→ 偏好（可选）
 */
import { useState, useEffect } from "react"
import { Bot, ChevronRight, ChevronLeft, Check, Sparkles } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { cn } from "@renderer/lib/utils"
import { useConversationStore } from "@renderer/stores/conversation-store"

interface ModelInfo { id: string; displayName: string }

const STEPS = [
  { num: 1, label: "基本信息" },
  { num: 2, label: "模型配置" },
  { num: 3, label: "偏好" },
] as const

export function OnboardingDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const [userName, setUserName] = useState("")
  const [selectedModel, setSelectedModel] = useState("deepseek/deepseek-v4-flash")
  const [apiKey, setApiKey] = useState("")
  const [profession, setProfession] = useState("")
  const [industry, setIndustry] = useState("")
  const [interests, setInterests] = useState("")
  const [saving, setSaving] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])

  useEffect(() => {
    void window.nexa.getSettings().then((s: { availableModels?: ModelInfo[]; defaultModel?: string }) => {
      if (s.availableModels) setModels(s.availableModels)
      if (s.defaultModel) setSelectedModel(s.defaultModel)
    })
  }, [])

  const handleComplete = async () => {
    setSaving(true)
    try {
      // 保存设置：用户名、默认模型、API Key、标记初始化完成
      const provider = selectedModel.split("/")[0]
      await window.nexa.setSettings({
        userName: userName.trim(),
        defaultModel: selectedModel,
        apiKeys: apiKey.trim() ? { [provider]: apiKey.trim() } : undefined,
        initialized: true,
      })
      // 刷新可用模型/provider 列表（写入 key 前会话内下拉无可选项）
      void useConversationStore.getState().initDefaultModel()

      // 偏好写入记忆层（可选填写）
      const prefs: string[] = []
      if (profession.trim()) prefs.push(`职业: ${profession.trim()}`)
      if (industry.trim()) prefs.push(`行业: ${industry.trim()}`)
      if (interests.trim()) prefs.push(`关注方向: ${interests.trim()}`)
      if (prefs.length > 0) {
        try {
          await window.nexa.memoryUpsert({
            layer: "preference",
            category: "用户画像",
            content: prefs.join("；"),
            confidence: 0.9,
          })
        } catch { /* 记忆写入失败不阻塞引导 */ }
      }

      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleNext = () => {
    if (step < 2) setStep(step + 1)
    else void handleComplete()
  }

  const handleBack = () => {
    if (step > 0) setStep(step - 1)
  }

  const canProceed = step === 0 ? userName.trim().length > 0 : true

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-[560px] max-w-[90vw] overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        {/* 步骤条 */}
        <div className="flex items-center gap-2 border-b border-border px-8 py-5">
          {STEPS.map((s, i) => (
            <div key={s.num} className="flex items-center gap-2">
              <div
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold transition-colors",
                  i <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                {i < step ? <Check className="h-3 w-3" /> : s.num}
              </div>
              <span className={cn("text-xs", i <= step ? "font-medium text-foreground" : "text-muted-foreground")}>
                {s.label}
              </span>
              {i < STEPS.length - 1 && <div className="mx-1 h-0.5 w-10 bg-border" />}
            </div>
          ))}
        </div>

        {/* 步骤内容 */}
        <div className="px-8 py-6">
          {step === 0 && (
            <div className="fade-in">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                  <Bot className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">欢迎使用 Nexa</h2>
                  <p className="text-sm text-muted-foreground">让我先认识一下你，之后就可以开始帮你干活了。</p>
                </div>
              </div>
              <div className="mt-6">
                <label className="mb-1.5 block text-sm font-medium">Nexa 怎么称呼你？</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && canProceed) handleNext() }}
                  placeholder="例如: Bond"
                  autoFocus
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="fade-in">
              <h2 className="mb-1 text-xl font-semibold">模型配置</h2>
              <p className="mb-6 text-sm text-muted-foreground">选择默认 AI 模型并填入 API Key，之后可随时修改。</p>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">默认模型</label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {models.length > 0 ? (
                      models.map((m) => (
                        <option key={m.id} value={m.id}>{m.displayName}</option>
                      ))
                    ) : (
                      <option value="deepseek/deepseek-v4-flash">DeepSeek V4 Flash</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">
                    API Key <span className="text-muted-foreground">（{selectedModel.split("/")[0]}）</span>
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Key 存储在本地 ~/.nexa/settings.json，不会上传。可稍后在设置中配置。
                  </p>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="fade-in">
              <h2 className="mb-1 text-xl font-semibold">偏好设置</h2>
              <p className="mb-6 text-sm text-muted-foreground">可选填写，Nexa 会记住这些信息来个性化服务。</p>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">职业</label>
                  <input
                    type="text"
                    value={profession}
                    onChange={(e) => setProfession(e.target.value)}
                    placeholder="例如: 前端工程师"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">行业</label>
                  <input
                    type="text"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    placeholder="例如: 互联网"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">关注方向</label>
                  <input
                    type="text"
                    value={interests}
                    onChange={(e) => setInterests(e.target.value)}
                    placeholder="例如: AI、Web3、SaaS"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-between gap-2 border-t border-border px-8 py-4">
          <Button variant="ghost" size="sm" onClick={handleBack} disabled={step === 0} className="gap-1">
            <ChevronLeft className="h-4 w-4" /> 上一步
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                // 跳过也标记完成，避免每次启动重复弹出；配置可稍后在设置中补全
                void window.nexa.setSettings({ initialized: true }).then(onClose)
              }}
              className="text-muted-foreground"
            >
              跳过
            </Button>
            <Button size="sm" onClick={handleNext} disabled={!canProceed || saving} className="gap-1.5">
              {step === 2 ? (
                <>
                  <Sparkles className="h-4 w-4" /> 开始使用 Nexa
                </>
              ) : (
                <>
                  下一步 <ChevronRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
