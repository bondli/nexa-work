/** 欢迎视图（无会话时显示）：从 chat-shell 迁入，含模式选择卡与首条消息输入 */
import { useEffect, useState } from "react"
import { Terminal, Bot, FolderOpen, Check } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { Card } from "@renderer/components/ui/card"
import { LogoIcon } from "@renderer/components/logo-icon"
import { cn } from "@renderer/lib/utils"
import { useConversationStore } from "@renderer/stores/conversation-store"
import { useExpertsStore } from "@renderer/stores/experts-store"
import { InputBar } from "./composer/input-bar"
import type { AttachmentInput } from "@shared/ipc-channels"

export function WelcomeView() {
  const createSession = useConversationStore((s) => s.createSession)
  const currentModel = useConversationStore((s) => s.currentModel)
  const currentExpertId = useExpertsStore((s) => s.currentExpertId)
  const pendingProjectPath = useConversationStore((s) => s.pendingProjectPath)
  const setPendingProjectPath = useConversationStore((s) => s.setPendingProjectPath)
  const pendingSkillId = useConversationStore((s) => s.pendingSkillId)
  const pendingPrompt = useConversationStore((s) => s.pendingPrompt)
  const setPendingExpertCreate = useConversationStore((s) => s.setPendingExpertCreate)
  const [text, setText] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedMode, setSelectedMode] = useState<"free" | "project">("free")
  const [projectPath, setProjectPath] = useState<string | null>(null)

  // 从侧边栏项目分组菜单点「新建任务」注入的路径 → 自动切到项目编码模式 + 预填目录
  useEffect(() => {
    if (pendingProjectPath) {
      setSelectedMode("project")
      setProjectPath(pendingProjectPath)
      setPendingProjectPath(null)
    }
  }, [pendingProjectPath, setPendingProjectPath])

  // 从技能包专家页点「新建专家」注入的 skill + prompt → 预填输入框
  useEffect(() => {
    if (pendingPrompt) {
      setText(pendingPrompt)
      setPendingExpertCreate(null, null)
    }
  }, [pendingPrompt, setPendingExpertCreate])

  /** 模式点击只切换选中态，目录由展开面板里的按钮选择 */
  const handleModeSelect = (mode: "free" | "project") => {
    setSelectedMode(mode)
    if (mode === "free") setProjectPath(null)
  }

  const pickDirectory = async () => {
    const picked = await window.nexa.openDirectoryPicker()
    if (picked) setProjectPath(picked as string)
  }

  const handleSend = async (finalText: string, opts: { expertId?: string; attachments?: AttachmentInput[] }): Promise<boolean> => {
    if ((!finalText.trim() && !opts.attachments?.length) || loading) return false
    if (selectedMode === "project" && !projectPath) {
      setError("请先选择要操作的项目目录")
      return false
    }
    setLoading(true)
    setError(null)
    try {
      await createSession({ initialMessage: finalText.trim(), mode: selectedMode, model: currentModel, projectPath: selectedMode === "project" ? projectPath ?? undefined : undefined, expertId: opts.expertId ?? currentExpertId, attachments: opts.attachments })
      setText("")
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex h-full flex-1 flex-col bg-card">
      {/* 顶部窗口拖动热区（64px） */}
      <div className="drag-bar h-16 shrink-0" />

      {/* 主内容区：自上而下 图标+Slogan / 任务类型选择 / 输入框（顶部对齐，不垂直居中） */}
      <div className="flex flex-1 flex-col items-center justify-start px-6 pb-8 pt-4">
        <div className="flex w-full max-w-4xl flex-col gap-6">
          {/* 第一行：应用图标 + Slogan（左右结构，图标不带底色） */}
          <div className="flex items-center gap-3">
            <LogoIcon className="h-10 w-10 shrink-0 text-foreground" />
            <p className="text-sm text-muted-foreground">你的智能工作助手，随时待命</p>
          </div>

          {/* 第二行：任务类型选择（左右结构） */}
          <div className="grid w-full grid-cols-2 gap-4">
            <ModeCard
              icon={<Terminal className="h-5 w-5" />}
              title="自由任务"
              desc={
                <>
                  写报告、数据分析、调研、规划…
                  <br />
                  系统自动创建隔离工作区
                  <code className="mt-1 block rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-primary">~/.nexa/workspaces/&lt;uuid&gt;/</code>
                </>
              }
              selected={selectedMode === "free"}
              onClick={() => handleModeSelect("free")}
              disabled={loading}
            />
            <ModeCard
              icon={<Bot className="h-5 w-5" />}
              title="项目编码"
              desc={
                <>
                  在已有项目上改代码
                  <br />
                  比如：&quot;xxx 目录下帮我加会员能力&quot;
                </>
              }
              selected={selectedMode === "project"}
              onClick={() => handleModeSelect("project")}
              disabled={loading}
            />
          </div>

          {/* 项目目录选择（仅项目编码模式展开） */}
          {selectedMode === "project" && (
            <div className="w-full rounded-xl border border-border bg-muted/40 p-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
                <FolderOpen className="h-3.5 w-3.5" />
                选择要操作的项目目录
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
                  {projectPath ?? "未选择目录"}
                </div>
                <Button variant="outline" size="sm" onClick={() => void pickDirectory()} disabled={loading}>
                  选择目录...
                </Button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Nexa 会扫描这个目录（自动读 AGENTS.md / README.md 等），然后在上面工作。
                <br />
                会话删除时不会清理这个目录——你的项目代码安全。
              </p>
            </div>
          )}

          {/* 第三行：输入框 */}
          <div>
            <InputBar
              value={text}
              onChange={setText}
              onSend={handleSend}
              loading={loading}
              placeholder={
                selectedMode === "project"
                  ? projectPath
                    ? "描述编码任务（项目目录已选择）…"
                    : "描述编码任务（请先选择项目目录）…"
                  : "描述你的任务..."
              }
              currentExpertId={currentExpertId}
              defaultSkillId={pendingSkillId}
            />
            {error && <p className="mt-2 text-center text-xs text-red-500">{error}</p>}
          </div>
        </div>
      </div>
    </main>
  )
}

function ModeCard({
  icon,
  title,
  desc,
  selected,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  title: string
  desc: React.ReactNode
  selected?: boolean
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && onClick) {
          e.preventDefault()
          onClick()
        }
      }}
      className={cn(
        "flex cursor-pointer flex-col items-start gap-2 rounded-xl border-2 p-4 text-left shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary bg-primary/5"
          : "hover:border-muted-foreground/40",
        disabled && "pointer-events-none opacity-50"
      )}
    >
      <div className="flex w-full items-center gap-2">
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-md", selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
          {icon}
        </div>
        <p className={cn("text-sm font-semibold", selected && "text-primary")}>{title}</p>
        {selected && (
          <span className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-2.5 w-2.5" />
          </span>
        )}
      </div>
      <div className="text-xs leading-relaxed text-muted-foreground">{desc}</div>
    </Card>
  )
}
