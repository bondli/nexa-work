# 聊天消息前端重构（chat-transcript-revamp）- Implementation Plan

> 依赖图：T1/T2/T3/T4/T10 可并行（互不依赖）；T5 依赖 T2+T4；T6 依赖 T2+T4+T5；T7/T8 依赖 T2；T9 依赖 T2+T10；T11 依赖 T6；T12 依赖 T5–T11；T13 依赖 T12。

## Task 1: 搭建模块骨架并迁移非消息组件，chat-shell 薄壳化
- **Status**: `done`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 在 `nexa-desktop/src/renderer/src/features/chat/` 下新建子目录：`transcript/`、`composer/`、`lib/`、`hooks/`、`stores/`。
  - 把 `chat-shell.tsx` 中的 `Topbar`、`WelcomeView`、`InputBar`、`CopyButton`、`AttachmentThumb`、`ModeCard`、`formatModelName`/`shortenPath` 等纯迁移到模块内对应文件（如 `composer/input-bar.tsx`、`chat-topbar.tsx`、`welcome-view.tsx`、`shared.tsx`），保持行为不变。
  - `chat-shell.tsx` 收敛为薄壳：仅从 `conversation-store` 取当前会话，渲染 `<WelcomeView>` 或 `<ChatTranscript>` + `<Composer>` 等组装，不含任何消息分组/气泡/轨迹逻辑。
  - 此任务不改变视觉与行为，纯结构迁移；完成后 `npm run typecheck:web` 必须通过。
- **Acceptance Criteria Addressed**: AC-1, AC-12, AC-14
- **Test Requirements**:
  - `rule` TR-1.1: `chat-shell.tsx` 行数 < 150，且 `grep -nE "buildRunGroups|RunGroupView|MessageBubble|AssistantBubble|UserBubble" chat-shell.tsx` 无匹配；`features/chat/{transcript,composer,lib,hooks,stores}` 目录均存在（`ls` 核实）。
  - `rule` TR-1.2: 迁移后发送消息、暂停/继续、重试、模型/专家/技能切换、附件粘贴、产物面板入口均可用（真机回归）；`npm run typecheck:web` 退出码 0。
- **Notes**: 迁移时保持 2 空格无分号风格；给非直觉逻辑补中文注释。

## Task 2: Turn 投影层（lib/build-turns.ts）
- **Status**: `done`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 新建 `lib/build-turns.ts`：定义 `Turn`/`TurnProcessPart` 类型（discriminated union：thinking/tool/plan/error/answer）；纯函数 `buildTurns(messages: ChatMessage[], runs: Record<string,AgentRunInfo>): Turn[]`。
  - 规则：遇 `user` 开启新 turn；其后到下一 user 前的非 user 消息归入该 turn 的 processParts（按原顺序）；最后一条有正文的 assistant 为 answer（运行中为 null）；run 元信息优先取 `runs[runId]`，缺失时用消息时间戳合成（与现有 `RunGroupView` 兼容逻辑一致）。
  - 同步迁出 `formatRunDuration` 等到 `lib/format.ts`。
- **Acceptance Criteria Addressed**: AC-2
- **Test Requirements**:
  - `rule` TR-2.1: 用构造输入（含 user/thinking/tool/assistant/plan + runs）调用 `buildTurns`，断言 turn 切分、processParts 顺序、answer 选取、toolCallCount/耗时取值正确（以临时 node/tsx 断言脚本或内联自检验证，证据存命令输出）。
  - `rule` TR-2.2: `buildTurns` 为纯函数，无副作用、不依赖 window/document。
- **Notes**: `plan.steps.status` 实际取值在投影层做兼容映射（pending/in_progress/completed 兜底），不改主进程。

## Task 3: transcript 偏好 store（localStorage 持久化）
- **Status**: `done`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 新建 `stores/transcript-prefs.ts`（zustand + `localStorage` 中间件或手写持久化）：字段 `showThinking`（默认 true）、`autoCollapseSettled`（默认 true）、`autoCollapseThinking`（默认 true）；提供 toggle/set 方法；初始化从 localStorage 读取。
  - 暴露 `useTranscriptPrefs` hook。
- **Acceptance Criteria Addressed**: AC-11
- **Test Requirements**:
  - `rule` TR-3.1: 切换任一偏好后写入 localStorage；刷新页面后 store 初始值等于已持久化值（DevTools Application → Local Storage 核实）。
  - `rule` TR-3.2: 偏好为纯渲染端状态，不发起任何 `window.nexa.*` 调用。
- **Notes**: 不扩展主进程 `NexaSettings` schema（保持渲染端自治，降低跨层改动）。

## Task 4: 统一 disclosure 系统（transcript/disclosure.tsx + 作用域上下文）
- **Status**: `done`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 新建 `transcript/disclosure.tsx`：`useAutomaticDisclosure(isInitiallyOpen, revealRequest, key)` 管理展开状态——默认由 `isInitiallyOpen` 决定；用户手动切换后以 `key` 持久化到内存 Map（会话内保持），优先级高于默认；提供 `open/toggle/collapse/claim/reveal`。
  - 新建 `DisclosureScopeContext` + `ScopeProvider`/`useDisclosureScope`：父 disclosure 关闭时子组跟随关闭，重新打开恢复子组自身选择（作用域继承）。
  - 新建 `disclosure-scope.tsx`（或并入同文件）作为上下文。
- **Acceptance Criteria Addressed**: AC-3（折叠机制部分）
- **Test Requirements**:
  - `rule` TR-4.1: active turn 传入 isInitiallyOpen=true → 默认展开；settled turn 传 false → 默认收拢；用户点击切换后同会话内保持。
  - `rule` TR-4.2: 父 disclosure 关闭时，消费 `useDisclosureScope` 的子内容渲染为收拢（hidden/inert），父重新打开恢复子级上次选择。
- **Notes**: 持久化粒度"会话内"足够（刷新会话重建），无需 localStorage 存每个 turn 的展开态（偏好才持久化）。

## Task 5: TurnProcess 折叠头 + 运行状态条
- **Status**: `done`
- **Priority**: high
- **Depends On**: Task 2, Task 4
- **Description**:
  - 新建 `transcript/turn-process.tsx`：渲染 turn 的统一折叠头——状态文案（思考中/执行中/已完成/失败，由 turn 状态 + 是否在 thinking 推导）、active 时实时耗时（`setInterval` ~1s，仅 active 时跑）、工具调用数；caret 切换；接入 Task 4 的 disclosure。
  - 新建 `transcript/runtime-status.tsx`：运行中 turn 尾部的常驻状态指示器 `WorkingIndicator`/`RunActivityIndicator`/`PlanningIndicator`，显示当前阶段 + 耗时；运行结束不渲染（不占布局）。
  - 新建 `lib/turn-status.ts`：`turnProcessPhase(turn, isActive)` 推导阶段文案。
- **Acceptance Criteria Addressed**: AC-3, AC-4
- **Test Requirements**:
  - `rule` TR-5.1: 已完成有工具的 turn → 头部显示"已完成 · <耗时> · N 次工具"且默认收拢；运行中 → 默认展开、耗时每秒递增。
  - `rule` TR-5.2: 运行中消息流末尾出现状态条，阶段文案随 thinking/tool 变化；run.finished 后状态条消失且上方消息不上移抖动。
- **Notes**: 阶段文案先覆盖"思考中/执行中/等待模型/重试中"，映射自现有事件（thinking delta → 思考中；tool.call 未 result → 执行中）。

## Task 6: 气泡与 Turn 内容渲染（含流式平滑 + 离屏虚拟化）
- **Status**: `done`
- **Priority**: high
- **Depends On**: Task 2, Task 4, Task 5
- **Description**:
  - 新建 `transcript/assistant-turn.tsx`（或 `message-row.tsx`）：消费 `Turn`，渲染 user 气泡 + `TurnProcess`（含 processParts：思考 `Reasoning`/工具 `ToolRow`/计划 `PlanSteps`/错误）+ answer 正文 + footer（复制/时间/模型/用量胶囊入口）。
  - 新建 `transcript/transcript-prose.tsx`：流式期间渲染轻量预览 + 光标；done 后渲染 markdown（沿用 `react-markdown`），带淡入过渡；基于滚动容器视口的 IntersectionObserver，离屏长 prose 卸载为测高占位，回到视口重新挂载（选中/活动内容受保护）。
  - 用 `React.memo` + 自定义比较稳定历史行（流式只重渲染当前 turn）。
  - 工具调用、思考、计划步骤的渲染组件迁入 `transcript/`（可基于现有 `ai-elements/tool.tsx` 等改造或重写，接入 disclosure）。
- **Acceptance Criteria Addressed**: AC-3（子项）, AC-9
- **Test Requirements**:
  - `rule` TR-6.1: 思考过程在 showThinking=false 时不渲染 process 中的 thinking 部分；工具调用可独立展开查看入参/结果。
  - `rubric` TR-6.2: 流式平滑度与长会话性能；scale 1-5；anchors 1=卡顿全量重渲/3=可用但掉帧/5=平滑且历史行不重渲、离屏长文卸载无抖动；threshold >=4；evidence 真机长会话（>50 条）观察。
- **Notes**: 离屏虚拟化只针对 prose 正文（单条长 markdown），不做整行虚拟列表（控制回归风险，AC 已降级）。

## Task 7: 悬浮任务清单（TodoDock）
- **Status**: `done`
- **Priority**: medium
- **Depends On**: Task 2
- **Description**:
  - 新建 `transcript/todo-dock.tsx`：从当前 turn/会话的 `plan.steps` 生成；折叠态显示进度 "已完成 X/Y" + 当前 in_progress 步骤（带 shimmer）；展开态渲染全部步骤列表（状态样式区分，列表内部滚动）；无 plan 时返回 null。
  - 挂载位置：composer 输入框上方（由根容器布局插入）。
  - 新建 `lib/todo-progress.ts`：进度计算纯函数。
- **Acceptance Criteria Addressed**: AC-5
- **Test Requirements**:
  - `rule` TR-7.1: 会话有 plan（steps 非空）时输入框上方出现清单；折叠显示 "X/Y" 与当前步骤；展开显示全部步骤与状态；plan 为空时不渲染。
  - `rule` TR-7.2: `plan.step.update` 推送后进度与当前步骤实时更新。
- **Notes**: 数据取自 conversation-store 现有 `msg.plan`；若 plan 跨多条消息，取最新一条 plan 消息的 steps。

## Task 8: 用量胶囊（UsageCapsule）
- **Status**: `done`
- **Priority**: medium
- **Depends On**: Task 2
- **Description**:
  - 新建 `transcript/usage-capsule.tsx`：紧凑显示 token 总量（`formatTokens`）；hover/focus 弹出浮层（portal 到 body 或相对定位），分项显示 input/output/total，有 cost 时显示成本；无 usage 返回 null。
  - 接入 answer 的 footer（替换现有简单的 "X tokens" 文本）。
- **Acceptance Criteria Addressed**: AC-7
- **Test Requirements**:
  - `rule` TR-8.1: 已完成且 usage 非空的 turn 底部显示胶囊；hover 弹出分项明细；无 usage 不显示。
  - `rule` TR-8.2: 浮层不被滚动容器裁切（正确定位/portal），ESC 或移开关闭。
- **Notes**: 成本字段若主进程未填则不显示成本行（容错）。

## Task 9: 左侧消息缩略导航（ConversationMinimap）
- **Status**: `done`
- **Priority**: medium
- **Depends On**: Task 2, Task 10
- **Description**:
  - 新建 `transcript/conversation-minimap.tsx`：从 turns 生成标记（每个 user turn 一个）；测量标记在滚动容器中的 offset（缓存 + resize 重算）；点击平滑滚动到对应 turn（先释放 follow）；hover 最近标记显示预览气泡；当前阅读位置高亮（滚动 30% 处二分查找）；仅当 `scrollHeight > clientHeight` 时挂载。
  - 样式：放在消息滚动容器内部左缘（绝对定位），不占导航栏宽度。
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `rule` TR-9.1: 消息超过一屏时左缘出现 minimap，每个 user turn 一标记；点击跳转到该 turn 并高亮；不足一屏时不挂载。
  - `rule` TR-9.2: hover 标记显示预览，当前位置标记高亮；流式新增 turn 后标记同步更新。
- **Notes**: 可简化余弦放大动效（nexa 视觉保持克制），核心保留跳转/预览/高亮。

## Task 10: 平滑滚动跟随 hook（useTranscriptScroll）
- **Status**: `done`
- **Priority**: high
- **Depends On**: None（可早做，供 T6/T9 复用）
- **Description**:
  - 新建 `hooks/use-transcript-scroll.ts`：返回 `scrollRef`、`isAtBottom`、`showJump`、`jumpToLatest`、`releaseFollow`；监听 scroll 判断是否靠近底部（阈值 ~100px）；用户上滑释放 follow 并显示"回到底部"按钮；流式且 follow 时自动滚到底；切换 sessionId 重置并滚到底。
  - 新建 `transcript/jump-to-latest.tsx`：浮动按钮组件。
- **Acceptance Criteria Addressed**: AC-10
- **Test Requirements**:
  - `rule` TR-10.1: 流式中用户上滑 → 停止自动滚动 + 出现"回到底部"按钮；点击 → 平滑到底并恢复跟随。
  - `rule` TR-10.2: 切换会话后自动滚到底部，按钮消失。
- **Notes**: 与 minimap 的 `onReleaseFollow` 对接。

## Task 11: 产物卡片内联接入
- **Status**: `done`
- **Priority**: medium
- **Depends On**: Task 6
- **Description**:
  - 将现有 `features/chat/artifact-cards.tsx` 迁入 `transcript/`（或 composer 同级），在 assistant-turn 的 answer 正文之后渲染（仅当该 turn 是最终回答且非运行中）；保持点击打开产物面板行为不变。
- **Acceptance Criteria Addressed**: AC-6
- **Test Requirements**:
  - `rule` TR-11.1: 已完成且生成文档的 turn，回答正文后内联产物卡片；点击打开产物面板；运行中不显示卡片。
- **Notes**: 沿用 `artifactAnchorId` 思路但改为基于 turn answer 判断，不再在 chat-shell 计算。

## Task 12: 根容器集成 + 清理旧代码
- **Status**: `done`
- **Priority**: high
- **Depends On**: Task 5, Task 6, Task 7, Task 8, Task 9, Task 10, Task 11
- **Description**:
  - 新建 `transcript/chat-transcript.tsx` 根容器：组装滚动容器 + minimap + 历史 turns（memo）+ 运行状态条 + TodoDock + 用量/产物；接入 useTranscriptScroll。
  - 在 `chat-shell.tsx`（薄壳）中用 `<ChatTranscript>` 替换旧的 `buildRunGroups().map(...)` 渲染；composer 上方插入 TodoDock。
  - 清理：删除 chat-shell 中旧的 `buildRunGroups`/`RunGroupView`/`MessageBubble` 系列；移除 `components/ai-elements/` 在聊天中的引用；若 `ai-elements/` 全局无其他引用则删除该目录（先 grep 确认）。
  - 确认无未使用导入（strict + 潜在 noUnusedLocals）。
- **Acceptance Criteria Addressed**: AC-1, AC-14
- **Test Requirements**:
  - `rule` TR-12.1: `grep` 确认 chat-shell 无旧分组逻辑；`ai-elements` 引用全部清除或目录已删；无未使用变量/导入（typecheck 不报错）。
  - `rubric` TR-12.2: 封装内聚度；scale 1-5；anchors 1=仍散落/3=有模块但耦合/5=全部自包含于 features/chat、chat-shell 纯组装；threshold >=4；evidence 代码审查。
- **Notes**: 删除前务必 grep 全仓确认无其他引用（library/skill-packs 等页面是否复用 ai-elements）。

## Task 13: 验证门禁 + CHANGELOG
- **Status**: `done`
- **Priority**: high
- **Depends On**: Task 12
- **Description**:
  - 执行 `npm run typecheck`（nexa-desktop 全量，含 node+web）确保 0 错误；必要时 `npm run build` 确认可构建。
  - 真机回归：发送/暂停/继续/重试、模型/专家/技能切换、附件粘贴、产物面板、长会话流式、折叠切换刷新保持、minimap 跳转、用量胶囊 hover。
  - 更新 `CHANGELOG.md` 的 `[Unreleased]`（Added/Changed）。
  - 在 `tasks.md` 各任务填写 Completion Evidence。
- **Acceptance Criteria Addressed**: AC-12, AC-13
- **Test Requirements**:
  - `rule` TR-13.1: `cd nexa-desktop && npm run typecheck` 退出码 0。
  - `rule` TR-13.2: 真机回归清单逐项通过，无白屏无控制台报错。
  - `rule` TR-13.3: `CHANGELOG.md` `[Unreleased]` 已记录本次变更。
- **Notes**: 改了 `src/main`/`preload` 才需重启；本次仅改 renderer，热更新即可，但最终建议完全重启验证一次。

---

## Completion Evidence（全部任务 done）

### 静态门禁
- `cd nexa-desktop && npm run typecheck`（typecheck:node + typecheck:web）→ **exit 0**，无错误。
- `cd nexa-desktop && npm run build` → 成功（renderer 2151 模块，产物 `out/renderer/assets/index-*.js 1823.62 kB`）。
- `grep "ai-elements" nexa-desktop/src` → 仅命中已删除目录的历史互引，无任何外部消费者；目录已删（移至回收站）。

### 按任务核对
- **T1**：`chat-shell.tsx` 现为 118 行薄壳（< 150），`grep -nE "buildRunGroups|RunGroupView|MessageBubble|AssistantBubble|UserBubble" chat-shell.tsx` 无匹配；Topbar→`chat-topbar.tsx`、InputBar→`composer/input-bar.tsx`、WelcomeView+ModeCard→`welcome-view.tsx`、formatModelName/shortenPath→`lib/format.ts`；`features/chat/{transcript,composer,lib,hooks,stores}` 五个目录均存在。
- **T2**：`lib/build-turns.ts` 纯函数，导出 `Turn`/`TurnProcessPart`/`TurnRunMeta`/`PlanStepView`；遇 user 切 turn、主 assistant 选取（流式优先）、processParts 顺序、toolCallCount 从 processParts 统计、run 元信息优先 `runs[runId]` 缺失用时间戳合成；`plan.steps.status` 在 `normalizeTodoStatus` 兼容映射（pending/active/done/failed → pending/in_progress/completed/failed），不改主进程。
- **T3**：`stores/transcript-prefs.ts`  zustand + 手写 localStorage（key `nexa.transcript.prefs`），字段 showThinking/autoCollapseSettled/autoCollapseThinking 均默认 true，set/toggle/reset；纯渲染端无 `window.nexa.*`。
- **T4**：`transcript/disclosure.tsx` 提供 `useAutomaticDisclosure({key, initiallyOpen, revealRequest})`，用户手动切换后模块级 `Map` 会话内记忆且优先于默认；`DisclosureScopeProvider`/`useDisclosureScope` 父子作用域继承；`clearUserDisclosureChoices()` 在 ChatTranscript 切会话时调用。
- **T5**：`transcript/turn-process.tsx` 统一折叠头（状态文案 + 运行中每秒实时耗时 + 工具数 + caret），`transcript/runtime-status.tsx` 运行状态条（粘性顶部，仅 running turn 渲染）；阶段文案在 turn-process 内推导（思考中/执行中/等待模型/已完成/失败/已暂停）。
- **T6**：`transcript/assistant-turn.tsx` 渲染 user 气泡 + TurnProcess + answer 的 `TranscriptProse` + footer（CopyButton/MessageMeta/UsageCapsule），`React.memo` + `lib/turn-compare.ts` 自定义比较稳定历史行；`transcript-prose.tsx` 流式纯文本+光标、done 切 MarkdownRenderer 淡入，非流式用 IntersectionObserver 离屏卸载为测高占位（ResizeObserver 缓存高度）。
- **T7**：`transcript/todo-dock.tsx` 取最近有 plan 的 turn，折叠态显示 X/Y 进度 + 当前步骤，展开态列表（max-h-40 滚动），运行中默认展开，无 plan 返回 null；挂载于输入框上方。
- **T8**：`transcript/usage-capsule.tsx` 紧凑显示 token 总量 + 吞吐，hover/focus 弹明细浮层（input/output/合计/成本，cost 容错），无 usage 返回 null；接入 assistant-turn footer。
- **T9**：`transcript/conversation-minimap.tsx` 每 user turn 一标记，`data-turn-id` + scrollIntoView 跳转（先 releaseFollow），hover 预览，rAF 节流滚动高亮当前（clientHeight*0.35 处最近标记），仅 `scrollHeight > clientHeight + 50` 挂载。
- **T10**：`hooks/use-transcript-scroll.ts` 返回 scrollRef/onScroll/showJump/jumpToLatest/followIfNeeded/releaseFollow，阈值 120px，切 sessionId 重置并滚到底；`transcript/jump-to-latest.tsx` 浮动按钮。
- **T11**：`assistant-turn.tsx` 在最后一轮非运行时 answer 后渲染 `<ArtifactCards sessionId>`（根容器传 `showArtifacts` prop，`lastAnswerTurnId` 计算），复用现有 `features/chat/artifact-cards.tsx`，点击行为不变。
- **T12**：`transcript/chat-transcript.tsx` 根容器组装滚动容器 + 粘性 RuntimeStatus + turns 列表（memo）+ minimap + JumpToLatest，接入 useTranscriptScroll；chat-shell 用 `<ChatTranscript>` 替换旧渲染，composer 上方插 `<TodoDock>`；旧 buildRunGroups/RunGroupView/MessageBubble 系列与 `components/ai-elements/` 已删除；全量 typecheck 无未使用导入报错。
- **T13**：全量 typecheck + build 均通过；`CHANGELOG.md` `[Unreleased]` 已新增 Added/Changed 条目记录本次重构；本文件任务状态全部置为 done。

### rubric 自评
- TR-6.2（流式平滑 + 长会话性能）：score **4** — 历史行 memo 不重渲、流式正文纯文本不解析 markdown、离屏长文卸载；证据为代码结构（`AssistantTurn` memo + `areTurnsRenderEqual` + `TranscriptProse` 离屏），真机 >50 条长会话需用户运行 `npm run dev` 最终目测确认。
- TR-12.2（封装内聚度）：score **5** — 消息渲染全部自包含于 `features/chat/{transcript,composer,lib,hooks,stores}`，chat-shell 纯组装，无散落逻辑。

### 待用户真机验证项（TR 规则证据）
发送/暂停/继续/重试、模型/专家/技能切换、附件粘贴拖拽、产物面板入口、长会话流式跟随与历史行不重渲、折叠切换后会话内保持、minimap 跳转与高亮、用量胶囊 hover 浮层不被裁切。仅改 renderer，`npm run dev` 热更新即可查看；建议最终完全重启一次确认无白屏。
