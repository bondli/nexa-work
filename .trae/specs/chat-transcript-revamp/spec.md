# 聊天消息前端重构（chat-transcript-revamp）- Product Requirements Document

## Overview
- **Summary**: 将 nexa-desktop 现有的"人机会话消息"前端渲染，替换为一套借鉴 PI-Desktop（vastsa/PI-Desktop）优秀信息架构与交互模式、但保持 nexa 自身 shadcn/neutral 视觉风格的**自包含封装模块**。覆盖：统一的 Turn 折叠轨迹、顶部运行状态条、输入框上方悬浮任务清单、消息内产物卡片、底部用量胶囊、平滑滚动跟随、左侧消息缩略导航栏、长消息离屏虚拟化、折叠偏好持久化。
- **Purpose**: 解决当前消息渲染散落在 `chat-shell.tsx`（~1300 行巨石）与 `components/ai-elements/` 多处、折叠状态各自为政、缺少运行状态可视化与性能优化的问题；把整条聊天链路封装进 `features/chat/` 一个模块，后续迭代不再四散。
- **Target Users**: nexa-desktop 的桌面端用户（在聊天会话页与 Agent 对话做任务的人）。

## Goals
- 新建自包含的 `features/chat/` 模块（内含 `transcript/`、`composer/`、`lib/`、`hooks/`、`stores/` 子目录），**接管全部聊天相关渲染**：消息列表、Turn 分组、气泡、轨迹折叠、运行状态条、悬浮任务清单、minimap、用量胶囊、滚动、输入框、顶栏、欢迎页。
- `chat-shell.tsx` 收敛为薄壳（< ~150 行），只负责从 store 取会话并组装模块，不再含任何消息分组/气泡/轨迹逻辑。
- 移植 PI-Desktop 的优秀交互与信息架构（适配 nexa 数据与视觉），不照搬其 CSS。
- 不改动主进程、协议、DB——现有数据（`plan.steps`/`usage`/`AgentRunInfo` 与各事件）已足够支撑全部能力。

## Non-Goals
- 不移植 PI-Desktop 中 nexa 无对应数据/能力的部分：子代理（subagent）拓扑、上下文压缩（compaction）分隔线、阅读窗口时间旅行（reading window）、环形菜单（radial menu）、i18n、插件插槽。
- 不改动 78px 全局导航栏（`nav-rail.tsx`）与应用骨架。
- 不新增 npm 依赖；只用已有 shadcn/ui、Tailwind v4、zustand、lucide-react、react-markdown。
- 不在渲染进程使用 Node API。
- 不改变发送/暂停/继续/重试/产物面板/附件/专家·技能·模型选择的既有行为（保持回归通过）。

## Background & Context

### 现有实现的问题（调研证据）
- [chat-shell.tsx](file:///Users/bondli/githubProjects/nexa-work/nexa-desktop/src/renderer/src/features/chat/chat-shell.tsx) 单文件 ~1300 行，混杂：`WelcomeView`、`ConversationView`、`Topbar`、`InputBar`、`buildRunGroups`、`RunGroupView`、`MessageBubble` 系列、`CopyButton`、`AttachmentThumb`、`formatRunDuration`。
- 消息分组逻辑 `buildRunGroups`/`RunGroupView`（[chat-shell.tsx#L903-L1022](file:///Users/bondli/githubProjects/nexa-work/nexa-desktop/src/renderer/src/features/chat/chat-shell.tsx#L903-L1022)）与气泡渲染耦合，折叠状态由 `Task`、`Tool`、`Reasoning` 各自独立管理，无统一作用域、无默认策略、无持久化。
- 缺少：运行中实时状态条（思考中/执行中/耗时/工具数）、输入框上方悬浮任务清单、左侧消息缩略导航、用量明细胶囊、平滑滚动跟随与"回到底部"按钮、长消息离屏渲染。
- `components/ai-elements/`（`message.tsx`/`tool.tsx`/`reasoning.tsx`/`plan.tsx`/`task.tsx`/`conversation.tsx`）是另一处散落点，与 chat-shell 内联渲染并存。

### PI-Desktop 优秀设计分析（`/tmp/pi-desktop-ref`，apps/desktop/src/features/chat/transcript）
1. **Turn 为核心渲染单元**（`AssistantTurn.tsx`）：消息先投影成 `TranscriptEntry`（`message` / `assistant-turn` / `compaction`），一个 assistant-turn 含 `process`（思考+工具+活动组）与 `responses`（最终回答）。回答在折叠区之外常显，过程收进统一 disclosure。
2. **统一折叠头 `TurnProcess`**（`TurnProcess.tsx`）：一个 turn 一个顶层 disclosure，头部显示状态（思考中/运行中/已完成/失败/已停止）、实时耗时（active 时每秒刷新）、工具调用数；active 默认展开、settled 默认收拢，用户手动选择通过 `useAutomaticDisclosure` 持久化且权威；子组通过 `DisclosureScope` 继承父级开关。
3. **活动分组 `ActivityGroup`**：工具调用/思考按 activity 分组，每组自带 disclosure 与默认策略（`autoCollapseSettledGroups`/`autoCollapseThinking` 偏好驱动），header 显示状态+耗时+步数，子项（`ToolRow` 等）各自再带一层细节 disclosure。
4. **运行状态条 `runtimeStatusLane`**（`ChatTranscript.tsx` 尾部）：运行中的 turn 尾部常驻一行 `WorkingIndicator`/`RunActivityIndicator`/`PlanningIndicator`，显示当前阶段（等待模型/压缩上下文/重试…）与耗时，phase 文案只在会停留的阶段才单独命名，避免闪烁。
5. **输入框上方悬浮任务清单 `TodoDock`**（`components/TodoDock.tsx`）：折叠态显示进度（如 "2/4 done"）+ 当前进行中步骤；展开显示全部步骤列表（自带滚动），in-progress 行带 shimmer 动画；无 todo 时不渲染。
6. **左侧缩略导航 `ConversationMinimap`**（`components/ConversationMinimap.tsx`）：每个 user turn 一个短划线标记，macOS Dock 式余弦放大（hover 附近标记横向放大）、最近标记弹预览气泡、点击平滑跳转、当前阅读位置高亮；仅在内容溢出一屏时才挂载。
7. **用量胶囊 `TurnUsageCapsule`**（`transcript/TurnUsageCapsule.tsx`）：紧凑显示速度 + token 总量 + 成本；hover/focus 弹出 portal 浮层，含 cache/input/output/write 比例条与逐项精确数值、总成本；用 `ResizeObserver` 跟随面板尺寸，`prefers-reduced-motion` 友好。
8. **流式文本 + 离屏虚拟化 `TranscriptProse`**（`transcript/TranscriptProse.tsx`）：基于 `.thread-scroll` 视口的 IntersectionObserver，离屏的长 prose 卸载为测高占位（避免大会话全量挂载 markdown），选中/搜索命中/活动内容受保护不卸载；流式期间始终挂载。
9. **渲染边界 memo 化**（`TranscriptHistory` + `transcriptEntryEqual`）：已稳定的历史行在只有尾部流式变化时不重渲染（bail out），避免长会话流式卡顿。
10. **平滑滚动跟随 `useTranscriptScroll`**：用户上滑即释放 follow、出现"回到底部"按钮；会话切换/加载时 skeleton veil 防抖动；bounded mount 窗口（仅渲染视口附近行，超大会话性能保障）。

### 移植决策（适配 nexa）
- 1–10 中，**1–9 全部移植**（其中 2/3/4 合并为 nexa 的 Turn 折叠 + 运行状态条体系；9 memo 边界用 React.memo + 自定义比较实现）。**10 的 bounded mount 窗口降级**：nexa 会话规模远小于 PI，先实现"离屏 prose 卸载 + 平滑滚动跟随 + 回到底部按钮"，不做整行虚拟窗口（降低复杂度与回归风险）。
- 不做 radial menu / reading window / compaction。
- 数据映射：nexa `ChatMessage[]` + `runs` → 投影成 Turn（见 Functional Requirements），无需主进程改动。

## Functional Requirements

- **FR-1（模块封装）**：新建 `features/chat/` 模块，子目录 `transcript/`（消息渲染）、`composer/`（输入框）、`lib/`（纯函数：turn 投影、活动摘要、折叠决策、耗时/用量格式化）、`hooks/`（滚动等）、`stores/`（transcript 偏好）。`chat-shell.tsx` 收敛为薄壳，仅取会话与组装；原 `Topbar`/`WelcomeView`/`InputBar`/`CopyButton`/`AttachmentThumb` 迁入模块；`components/ai-elements/` 在聊天中不再被引用（若全局无其他引用则删除）。
- **FR-2（Turn 投影）**：`lib/build-turns.ts` 将 `ChatMessage[]` + `runs` 投影为 `Turn[]`：每个 user 消息开启一个 turn，turn 内含 `processParts`（thinking / tool / plan / error 消息，按出现顺序）与 `answer`（最后一条有正文的 assistant 消息，运行中为 null），以及 run 元信息（status/startedAt/durationMs/toolCallCount）。纯函数，可独立验证。
- **FR-3（统一 Turn 折叠头）**：每个有过程的 turn 渲染一个 `TurnProcess` disclosure 头：状态文案（思考中/执行中/已完成/失败）、active 时实时耗时（~1s 刷新）、工具调用数；active 默认展开、完成默认收拢；用户手动切换的选择按 turnId 持久化（刷新会话后恢复）；展开后内部各子项（思考/工具/计划）保持自己的细节折叠，继承父级作用域。
- **FR-4（运行状态条）**：运行中的 turn，在其尾部（消息流末尾）常驻一行运行状态指示器，显示当前阶段（思考中/执行中/等待模型/重试中…）与已耗时、工具数，~1s 刷新；无运行 turn 时不渲染（不占布局，避免完成后布局抖动）。
- **FR-5（悬浮任务清单）**：当当前会话存在 plan（`plan.steps` 非空）时，在输入框上方悬浮一个可折叠的任务清单：折叠态显示完成进度（如 "2/4"）与当前 in_progress 步骤；展开显示全部步骤（pending/in_progress/completed 不同样式，列表内部滚动）。plan 为空时不渲染。
- **FR-6（产物卡片内联）**：任务生成的文档卡片内联在该轮最终回答正文之后（沿用现有 `ArtifactCards`，迁入模块并接到 Turn 的 answer 上）；运行中不展示。
- **FR-7（用量胶囊）**：每个已完成且有 usage 的 turn，在回答底部渲染用量胶囊：紧凑显示 token 总量 +（可选）速度；hover/focus 弹出明细浮层（input/output/total 分项，有 cost 时显示成本）。无 usage 时不渲染。
- **FR-8（左侧缩略导航）**：消息列表左侧渲染 minimap 轨道：每个 user turn 一个标记，点击平滑滚动到该 turn，hover 显示该 turn 预览并高亮当前阅读位置；仅当内容溢出容器一屏时挂载。
- **FR-9（流式文本平滑 + 离屏虚拟化）**：assistant 正文流式期间平滑渲染（流式用轻量预览 + 光标，done 后切 markdown，带淡入过渡）；非流式的长 prose 在滚出视口时卸载为测高占位，回到视口重新挂载（受选中/搜索保护）。
- **FR-10（平滑滚动跟随）**：用户在底部附近时流式自动滚到底；用户上滑后停止跟随并显示"回到底部"按钮，点击平滑滚动；切换会话时重置跟随状态并滚到底。
- **FR-11（折叠偏好持久化）**：新增渲染端 `transcript-prefs` store（localStorage 持久化），含 `showThinking`、`autoCollapseSettled`、`autoCollapseThinking`；驱动 FR-3/思考可见性/分组默认折叠；提供 inline 切换入口（如 turn 头部或设置区）。
- **FR-12（保留能力无回归）**：复制消息、时间/模型 footer、错误展示、附件缩略图、发送/暂停/继续/重试、产物面板入口、专家/技能/模型选择等既有行为保持可用。

## Non-Functional Requirements
- **NFR-1（封装收敛）**：所有聊天消息渲染代码位于 `features/chat/` 下；`chat-shell.tsx` 不含消息分组、气泡、轨迹、折叠相关逻辑（grep 验证无 `buildRunGroups`/`RunGroupView`/`MessageBubble` 残留）。
- **NFR-2（无新增依赖）**：`nexa-desktop/package.json` 依赖不新增。
- **NFR-3（技术栈约束）**：仅 shadcn/ui + Tailwind v4 + zustand + lucide-react；渲染进程无 `fs`/`path`/`require`；2 空格缩进、无分号。
- **NFR-4（类型门禁）**：`npm run typecheck`（至少 `typecheck:web`，目标全量 `typecheck`）通过。
- **NFR-5（注释）**：业务逻辑、跨端约定、非直觉写法配中文注释。
- **NFR-6（流式性能）**：流式 delta 更新不重渲染已稳定的历史 turn（React.memo + 浅比较边界）。
- **NFR-7（视觉一致）**：沿用 nexa 现有语义 token（`text-muted-foreground`/`bg-card` 等）与 shadcn new-york 风格，不引入硬编码颜色或与现有主题冲突的样式。

## Constraints
- **Technical**: 渲染进程为浏览器环境（contextIsolation）；经 `window.nexa.*` 访问主进程；不可引入新状态/UI/HTTP 库。
- **Business**: 不改变产品既有交互契约（发送/控制按钮位置等可微调但功能不丢失）。
- **Dependencies**: 依赖现有 `conversation-store` 的 `ChatMessage`/`AgentRunInfo`/`Conversation` 与 `ipc-channels` 事件；不修改其形状。

## Assumptions
- 现有 `plan.steps` 的 `status` 字段取值可映射为 pending/in_progress/completed（若实际取值不同，在投影层做兼容映射，不改主进程）。
- `usage.totalTokens` / `input` / `output` / `cost` 在 `message.assistant.done` 时已落库并透传到 `ChatMessage.usage`（按现有 store 代码成立）。
- 一个会话同时只有一个运行中的 run（现有 `activeRunBySession` 已保证），故运行状态条只需追踪当前 run。
- 渲染端 localStorage 可用（Electron renderer 默认可用）。

## Acceptance Criteria

### AC-1: 模块封装与收敛
- **Type**: `rule`
- **Given**: 重构完成的 nexa-desktop 渲染端
- **When**: 检查 `features/chat/` 目录与 `chat-shell.tsx`
- **Then**: `features/chat/` 下存在 `transcript/`、`composer/`、`lib/`、`hooks/`、`stores/` 子目录并承载全部聊天渲染；`chat-shell.tsx` 行数 < 150 且不含 `buildRunGroups`/`RunGroupView`/`MessageBubble` 定义
- **Pass Condition**: `grep -nE "buildRunGroups|RunGroupView|MessageBubble" nexa-desktop/src/renderer/src/features/chat/chat-shell.tsx` 无匹配；目录存在性经 `ls` 核实
- **Evidence**: grep 输出 + ls 输出

### AC-2: Turn 投影正确
- **Type**: `rule`
- **Given**: 一组含 user/assistant/tool/plan/thinking 的 `ChatMessage[]` 与对应 `runs`
- **When**: 调用 `buildTurns(messages, runs)`
- **Then**: 每个 user 消息产生一个 turn；turn.processParts 包含其后到下一 user 前的 thinking/tool/plan/error；turn.answer 为最后一条有正文 assistant（运行中为 null）；toolCallCount 与耗时取自 run 元信息或消息合成
- **Pass Condition**: 用固定输入快照断言输出结构（在实现中以可运行的 typecheck/内联断言或临时脚本验证，结果记入任务证据）
- **Evidence**: 验证命令输出

### AC-3: Turn 折叠头与默认策略
- **Type**: `rule`
- **Given**: 一个含工具调用的已完成 turn 和一个运行中 turn
- **When**: 渲染会话
- **Then**: 已完成 turn 的过程默认收拢，头部显示"已完成 · 耗时 · N 次工具"；运行中 turn 默认展开且头部耗时每秒递增；点击头部可切换；用户切换后刷新会话仍保持该 turn 的选择
- **Pass Condition**: 真机/Electron 窗口观察 + 刷新后状态保持
- **Evidence**: 截图或观察记录

### AC-4: 运行状态条
- **Type**: `rule`
- **Given**: 会话正在运行（Agent 思考或调用工具）
- **When**: 观察消息流末尾
- **Then**: 常驻一行状态指示器，文案随阶段变化（思考中/执行中…），耗时与工具数实时更新；运行结束后该行消失且不引起布局上移抖动
- **Pass Condition**: 真机观察
- **Evidence**: 观察记录

### AC-5: 悬浮任务清单
- **Type**: `rule`
- **Given**: 会话产生了 plan（`plan.created` 且 steps 非空）
- **When**: 观察输入框上方
- **Then**: 出现折叠的任务清单，显示 "已完成 X/Y" 与当前进行中步骤；点击展开可见全部步骤及状态；plan 为空时不出现
- **Pass Condition**: 真机观察
- **Evidence**: 观察记录

### AC-6: 产物卡片内联
- **Type**: `rule`
- **Given**: 一个已完成、生成了文档的 turn
- **When**: 查看该轮最终回答
- **Then**: 文档卡片内联在回答正文之后，点击可打开产物面板；运行中不显示卡片
- **Pass Condition**: 真机观察
- **Evidence**: 观察记录

### AC-7: 用量胶囊
- **Type**: `rule`
- **Given**: 一个已完成且 usage 非空的 turn
- **When**: 查看回答底部
- **Then**: 显示紧凑用量胶囊（token 总量）；hover/focus 弹出分项明细浮层；无 usage 时不显示
- **Pass Condition**: 真机观察
- **Evidence**: 观察记录

### AC-8: 左侧缩略导航
- **Type**: `rule`
- **Given**: 会话消息超过一屏
- **When**: 观察消息区左缘
- **Then**: 出现 minimap 轨道，每个 user turn 一标记，点击跳转、hover 预览、当前位置高亮；不足一屏时不挂载
- **Pass Condition**: 真机观察
- **Evidence**: 观察记录

### AC-9: 流式平滑与离屏虚拟化
- **Type**: `rubric`
- **Dimension**: 流式渲染平滑度与长会话性能
- **Scale**: 1-5
- **Anchors**: 1 = 流式卡顿/每帧全量重渲染历史；3 = 流式可用但长会话明显掉帧；5 = 流式平滑、历史行不重渲染、离屏长文卸载占位无抖动
- **Pass Threshold**: >= 4
- **Evidence**: 真机长会话（>50 条消息）流式观察 + React DevTools/profiler 或肉眼判断

### AC-10: 平滑滚动跟随
- **Type**: `rule`
- **Given**: 会话流式输出中
- **When**: 用户上滑查看历史，然后点击"回到底部"
- **Then**: 上滑后停止自动滚动并出现"回到底部"按钮；点击后平滑滚到底并恢复跟随；切换会话自动到底
- **Pass Condition**: 真机观察
- **Evidence**: 观察记录

### AC-11: 折叠偏好持久化
- **Type**: `rule`
- **Given**: 用户在设置/inline 切换了"显示思考过程"或"默认折叠已完成组"
- **When**: 重启应用或切换会话再回来
- **Then**: 偏好保持生效（localStorage 持久化），思考可见性与默认折叠行为随之变化
- **Pass Condition**: 切换 → 重启 → 观察
- **Evidence**: 观察记录

### AC-12: 既有功能无回归
- **Type**: `rule`
- **Given**: 重构后的应用
- **When**: 执行：发送消息、暂停/继续、失败重试、复制消息、切换模型/专家/技能、附件粘贴、打开产物面板
- **Then**: 全部行为与重构前一致，无报错、无白屏
- **Pass Condition**: 逐项真机验证通过
- **Evidence**: 验证清单记录

### AC-13: 类型检查通过
- **Type**: `rule`
- **Given**: 重构完成
- **When**: 在 `nexa-desktop` 执行 `npm run typecheck`
- **Then**: 退出码 0，无类型错误
- **Pass Condition**: 命令退出码 0
- **Evidence**: 命令输出

### AC-14: 封装内聚度
- **Type**: `rubric`
- **Dimension**: 消息渲染是否集中、不再散落
- **Scale**: 1-5
- **Anchors**: 1 = 逻辑仍散在 chat-shell 与多个组件；3 = 有模块但仍有跨文件耦合；5 = 全部消息渲染自包含于 features/chat/，chat-shell 纯组装，单一职责清晰
- **Pass Threshold**: >= 4
- **Evidence**: 代码结构审查

## Open Questions
- [ ] `plan.steps` 的 `status` 实际取值集合需在实现时确认（兼容映射兜底，不阻塞）。
- [ ] minimap 与现有 78px 导航栏的位置关系：minimap 放在消息滚动容器内部左缘（不占导航栏宽度），实现时确认视觉不冲突。
- [ ] 折叠偏好的入口放 inline（turn 头部小开关）还是设置弹框——实现时优先 inline，设置弹框集成视情况。
