# 更新日志

本文件记录 Nexa 每次修改的重要内容。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

### Added
- 桌面端：已配对设备支持重命名（设置 → 手机配对，设备行新增铅笔按钮 + 改名弹框，最长 32 字）。名称以本机别名形式保存在 `~/.nexa/relay-state.json` 的 `renames` 字段，并在每次收到 `relay:hello` / `relay:paired` 时覆盖服务端下发的手机名，避免重连后被冲回原名；解绑时同步清除别名。新增 IPC `relay:rename`（preload 暴露 `window.nexa.relayRename`）
- 通用设置新增「字体大小」选项（12/14/16px，持久化到 settings.chatFontSize），经 `--chat-font-size` CSS 变量仅作用于会话消息内容
- 会话消息流末尾新增「生成的产物」文件卡（Markdown/HTML/PDF 等文档类文件），点击直达右侧产物面板并自动展开父目录定位预览（artifacts-store 新增 openArtifact）
- 本地实现 shadcn ai-elements 组件（Conversation / Message / MessageContent / Response / Tool / PlanCard，API 对齐官方），消息展示统一组件化、降低维护成本
- 桌面端：资料库「文档」筛选汇聚自由任务产出的 md/html 文档（主进程递归扫描任务 workspace，按修改时间倒序限 200 条），不提供删除入口，点击经右侧产物抽屉预览（md 走 Markdown 渲染，html 走内置浏览器静态服务加载）
- 手机端：资料库条目详情支持富预览——图片原图按宽高比等比展示（libraryGet 新增 dataUrl 下发）、html 文档经 WebView 渲染、md 经 Markdown 渲染
- 手机端：发消息框与「新建任务」页新增「+」按钮，可从相册选图（最多 3 张，自动压缩至长边 1600 / JPEG 0.7 以适配中继 4MB 上限）随首条消息发送，会话内支持仅发图不发文字；桌面端中继 task:create / session:send 转发附件并落盘 ~/.nexa/uploads，供 Agent 收藏入库（选图压缩逻辑抽为 lib/image-picker 共用）
- 手机端：会话消息气泡渲染图片附件——session:messages 回包附件转 dataUrl 下发（单张超 2.5MB 跳过防中继超限），带图发送后整列刷新替换无图气泡
- 手机端：我的页新增「字体」设置（12/14/16px），仅作用于任务详情页消息正文字号，持久化到 SecureStore
- 手机端：资料库右上角新增「+」新增笔记入口，新增笔记页可填标题/正文并写入桌面端 note 表（中继 note.create）
- 手机端：我的页通知设置对齐桌面——任务通知开关 + 通知音四选（灵动/清脆/悠扬/静音），切换即试听；提示音由运行时合成 WAV 播放，不引入音频资源文件
- 手机端：任务详情页对齐桌面端任务轨迹（RunTrace）——按用户消息切分为任务组，思考过程与工具调用收拢进「任务耗时 X分Y秒 · N 次工具调用」摘要条（运行中自动展开、结束后自动收拢，最终回答常显）；耗时/工具数取自桌面端 agent_runs 真实数据（新增中继 session.runs，消息带 runId 关联），无工具调用的普通问答不显示摘要条
- 手机端：任务页新增「已归档」分组，展示归档任务（中继 session:list 合并未归档 + 归档两批）
- 手机端：接入系统级推送（expo-notifications）——Android 建立「任务通知」有声/静音两个通知渠道，打开开关时申请 POST_NOTIFICATIONS 权限；后台/锁屏时由系统通知提醒，前台改为应用内弹窗 + 合成提示音；Expo Go 无原生模块时自动降级为应用内提醒（不崩溃）

### Changed
- 手机端：非 tab 页面（任务详情/资料详情/产物预览/执行记录/配对等）切入动效由 Android 默认的「缩小 0.85 → 1 + 淡入」（观感是闪一下出现）改为从右侧推入的 `slide_from_right`；新建任务/新增笔记/切换电脑三个 modal 页改为 `slide_from_bottom`
- 手机端：任务列表卡片右侧新增进入箭头（ChevronRight），明确「点进去」的入口暗示
- 手机端：任务详情页消息展示对齐桌面端 agentic UI——助手消息不再套灰底气泡，改为「应用 Logo + Nexa」头部 + 文档式正文；执行过程收进最终回答，头部下方一行灰色小字「已完成 42s ›」点击展开（运行中默认展开、结束收拢）；思考过程独立成块（流式中自动展开、结束收拢）、工具调用改为弱化一行（图标 + 名称 + 失败标记，点开看输出）；任务产物卡移入最终回答（正文之后、元信息之前，对齐桌面端，不再显示「生成的产物」标题），正文底部新增「复制图标 + 时间 · 模型名 · k/M 单位 token 用量」元信息，复制用 expo-clipboard，模型名与用量由中继 `session:messages` 补发 `createdAt` / `usage` 字段、assistant.done 事件补存 model / usage
- 桌面端：任务执行消息展示由 chat UI 升级为 agentic UI（对齐 shadcn ai-elements）——一轮 agent loop 的执行过程收进最终回答，在「Logo + Nexa」同一行下方显示一行灰色小字「已完成 42s ›」，点击展开思考过程 / 工具调用 / 中间消息（运行中默认展开、结束收拢）；思考过程改用 Reasoning（流式中自动展开、结束收拢、标题 shimmer 动效）；工具调用改用 Tool 行（状态圆点 + 语义图标 + 关键参数摘要 + 耗时，展开看输入/输出）；执行计划改用 Plan（进度条 + 步骤状态）；正文改为文档式排版 + 底部常显操作栏（复制 / 时间 / 模型名 / 用量，模型名裸文字展示，复制按钮 hover 才出现），不再套描边气泡；token 数按 k/M 单位格式化（如 5.5k tokens，title 显示精确值）；新增 `components/ai-elements/{message,shimmer,reasoning,tool,task,plan}.tsx`
- 桌面端：原生 `<select>` 全部替换为 shadcn/ui Select（new-york 风格）——新增 `components/ui/select.tsx`（@radix-ui/react-select 封装），三处替换：笔记编辑器分类选择、设置弹框通知提示音 + 默认模型、Onboarding 向导默认模型；原 `onChange={(e) => e.target.value}` 统一为 `onValueChange={(v) => ...}`
- 桌面端：会话自动标题上限由 20 字放宽到 30 字（提示词约束 + normalizeTitle 截断 + 首条消息/定时任务的兜底标题同步）
- 手机端：任务列表由分隔线列表改为白色圆角卡片——左侧状态图标（进行中 loading、失败红叉、暂停、完成勾），右侧两行展示任务名与更新时间
- 桌面端：`npm run pack` 改为一次产出 mac arm64 dmg（`Nexa-0.1.0-arm64.dmg`）+ Windows x64 NSIS 安装包（`Nexa-0.1.0-x64.exe`），均免签名；Windows 目标显式锁定 x64（否则在 Apple Silicon 上会按宿主架构产出 arm64 包）并统一产物命名模板 `${productName}-${version}-${arch}.${ext}`（原为带空格的 `Nexa Setup 0.1.0.exe`），`dist` 仍只出 mac 包
- 桌面端：mac 打包目标只保留 arm64，`npm run dist` 不再额外产出 Intel（x64）dmg
- 手机端：任务详情页发送按钮改为圆形图标按钮（40×40 圆底 + 白色向上箭头，发送中显示加载圈），与桌面端/主流 IM 一致
- 手机端：任务详情页消息加载完成后默认滚动到最新一条（每会话仅一次，延迟一帧等 Markdown/表格测量完成后再滚，避免停在中间）
- 手机端：`(tabs)/profile.tsx` 重命名为 `(tabs)/settings.tsx`（路由名同步改为 settings），手机端不再有「我的」概念，统一为设置页
- 手机端：桌面图标改为「黑色背景 + 白色机器人 logo」，logo 在上一版基础上再缩小到 2/3（自适应前景约占画布 37%、传统图标 40%），移除 monochrome 层避免被系统主题图标渲染成白底黑字；favicon 同步改为黑底白标
- 手机端：启动页改为机器人 logo（expo-splash-screen 插件显式配置 image/imageWidth/backgroundColor=#0a0a0a，此前插件未传 props 导致用的是 SDK 默认灰色 logo + 白底）
- 手机端：通知开关与系统通知权限双向对齐——开关状态 = 系统权限（系统里开了 App 开关自动开、关了自动关）；打开时申请权限，失败弹框可直接去设置；关闭时因 Android 不允许 App 自行撤销权限，改为清理待发通知并直接跳转系统通知设置页；权限缺失时通知卡片常驻「去设置」提示行
- 手机端：资料库图片条目支持点击全屏查看（新增 ImageViewer）：双指捏合缩放、双击放大/复位、放大后单指拖动、点击图片外空白处或右上角关闭；手势改用 RN 原生 onTouchStart/Move/End，修复此前双指捏合无效（PanResponder 被外层 ScrollView 抢走 responder）
- 手机端：资料条目增加 LRU 缓存（最近 6 条，含图片 base64），短时间内重复查看不再重新走中继加载
- 手机端：任务详情页产物区改为消息加载完成后才渲染，消除「先出产物、再出消息」的错位感
- 手机端：解绑配对电脑的二次确认改为应用内主题化弹框（新增 components/confirm-dialog，替换系统 Alert）
- 手机端：底部导航「我的」更名为「设置」（tab 文案、页面标题与图标同步，图标由人头换为齿轮，对齐桌面端），并收紧页面标题与首个分组之间的间距
- 手机端：任务详情页导航栏标题改为具体任务名（取自会话列表，超长由单行省略号截断；未加载到标题时回退「任务详情」）
- 桌面端：全局图标导航栏 NavRail 由 `features/sidebar/` 迁至 `components/nav-rail.tsx`——features 只保留业务域目录，应用骨架组件统一放 components
- 桌面端：新增任务页（欢迎页）改为自上而下的三段式布局——第一行应用图标 + Slogan（左右结构），第二行自由任务 / 项目编码两张选择卡（左右结构），第三行输入框（不再固定在页面底部）
- 设置弹框模型配置独立为「模型」tab（通用 tab 仅保留外观/字体）；弹框固定高度 640px，滚动收敛在右侧内容区，切换 tab 高度不再抖动；移除左下角常驻的「修改即保存」提示（自动保存成功/失败反馈保留在模型 tab 标题行）
- 设置由全页视图改为全局弹框：ui-store 以 settingsOpen 控制开关，新增 ui/dialog（Radix Dialog）与 settings-dialog，移除 settings-page 与 ActiveView 的 "settings" 分支
- 模型配置改为「修改即保存」：字段变更后 600ms 防抖自动持久化，移除保存按钮，保存成功/失败反馈展示在模型 tab 标题行
- shadcn/ui 组件化推进：新增 Card / Badge / Avatar / Input，设置弹框 provider 卡片与知识库/记忆条目、欢迎页模式选择卡、nav-rail 用户头像等完成迁移
- MarkdownRenderer 与消息气泡字号跟随 `--chat-font-size`
- 桌面端：任务自动标题字数上限由 12 字放宽至 20 字；任务列表超长标题省略号截断，hover 经 title 属性显示完整标题
- 桌面端：ArtifactsPanel 重构为通用文档渲染组件（features/artifacts-panel → components/artifacts-panel），职责聚焦文档渲染，显式拆分两种形态——单文件纯渲染（资料库文档/消息文件卡点开即看）与带文件树浏览（任务产物左预览+右树切换）；组件内拆分为外壳 / file-preview / tree-node / utils 四个模块
- 手机端：底部菜单与资料页标题「资料」更名「资料库」；资料库顶部 tab 改为「文件 / 笔记」，文件覆盖文章/文档/图片/金句四种类型徽章
- 手机端：我的页外观设置改为通知同款行内样式，右侧单选组（系统 / 浅色 / 深色）
- 手机端：笔记页仅展示纯笔记（不再混入金句），列表全量加载
- 手机端：中继 RPC 默认超时由 30s 降至 12s，桌面端无响应时错误反馈更及时

### Fixed
- 桌面端 + 手机端：助手消息的模型名在重新进入会话后消失——`messages` 表没有 model 列，模型标识只在流式 `assistant.done` 事件里下发、从未落库；现新增 `messages.model` 列（旧库自动 ALTER 补列）并在 `insertAssistant` 时写入 `provider/modelId`，历史加载与中继 `session:messages` 一并回传，重新进入会话仍可展示模型名（本次改动前的历史消息仍为 null）
- 桌面端：历史消息的 token 用量不显示——`messages.listBySession` 只对 attachments 做了 JSON 反序列化，`token_usage` 仍以 TEXT 原样返回，渲染端按对象读取 `totalTokens` 得到 `undefined`、按 input+output 兜底得到 0，于是整行被隐藏；现统一在 DAO 层解析 token_usage，并把时间/用量移入常显操作栏（复制按钮 hover 才出现）
- 桌面端：笔记编辑页切到预览态后内容较长时看不到最底部——编辑器根节点原为 `h-full`（父级还有 PageTitleBar，100% 高度导致底部溢出被裁掉），改为 `flex-1 min-h-0`；滚动区同步补 `min-h-0`，让溢出内容进入滚动而不是被裁切
- 桌面端：笔记预览态 GFM 表格渲染不出——预览组件此前用的是手写正则版 `renderMarkdown`，只支持标题/粗体/列表/代码块，没有实现 GFM 表格（`| a | b |` + `|---|---|`）/任务列表语法，导致标准 Markdown 表格被当成普通段落输出；现已改用仓库统一的 `MarkdownRenderer`（react-markdown 9 + remark-gfm 4），表格 / 任务列表 / 删除线均正确渲染，样式与会话消息保持一致
- 桌面端：新增单实例锁（app.requestSingleInstanceLock）——此前可同时开多个桌面端，多实例会各自用 sql.js 整库回写同一 SQLite 文件（后写覆盖先写），并以同一 deviceId 争抢中继连接（手机端表现为「一会儿在线一会儿离线」）；现在重复启动会把已有窗口唤到前台，新进程直接退出，且在 ready 前二次校验，避免未拿到锁的进程做初始化
- 手机端：底部手势指示条区域透出白色——根布局改为 SafeAreaProvider + 按 safe-area inset 铺主题底色（画在 Stack 底层，不遮挡页面内容），浅色（#f5f5f5）/深色（#0a0a0a）均与页面背景一致；任务详情页输入框增加底部 inset 内边距，不再被手势条压住；关闭手势提示条（inset=0）时自动不渲染
- 手机端：华为等厂商 ROM 手势提示条区域无法跟随 App 主题——app.json 改用 expo-navigation-bar 插件 `enforceContrast: false`（关闭 Android 导航栏对比度遮罩，该遮罩只跟随系统主题、会盖住应用底色），并接入 expo-system-ui 在运行时把根视图/窗口底色设为当前主题色（移除已失效的 androidNavigationBar 配置）；需重新构建安装包生效
- 手机端：页面头部返回按钮的 Android 水波纹/暗色闪动——根 Stack 统一用自定义 headerLeft（透明 ripple），不再使用原生返回键
- 桌面端：设置 · 手机配对页输入中继地址时输入框闪烁——配对码倒计时 500ms 定时器放在页面组件内，导致整页（含输入框）每 500ms 重渲染；倒计时抽为独立组件（1s 粒度），页面其余部分不再随计时器重渲染
- 手机端：深色主题下顶部状态栏图标改为浅色（此前系统固定浅色模式导致电池/时间不可见）
- 手机端：底部 tab 点击时去掉 Android 默认水波纹暗色闪动
- 手机端：定时任务列表项点击无反应修复（`Link asChild` 包裹 `View` 不透传 onPress，改为 `Pressable`），点击进入执行记录页；执行记录点击可跳关联任务详情
- 手机端：修复任务/定时任务/执行记录/资料库的时间显示为 1970 年——桌面端 SQLite 时间字段为秒，手机端直接 `new Date(秒)` 被当毫秒；新增 lib/time.ts 统一换算（兼容秒/毫秒）
- 修复顶部全局拖动覆盖层（fixed h-16 z-70）遮挡页面顶栏按钮点击的问题：移除全局兜底层，改由 nav-rail Logo 容器自带 drag-bar 承担拖动
- Tailwind v4 preflight 将 button 光标重置为 default，global.css 统一为可点击元素恢复手型光标（disabled 为 not-allowed）
- nav-rail 用户头像圆形背景加深（bg-foreground/15 + 内描边），深浅色主题下均清晰可见
- 修复 runtime.generateTitleAsync：getApiKey 可返回 undefined 导致编译失败（provider 禁用/未配 key 时跳过标题生成）
- 桌面端：删除任务不再级联删除知识库条目（金句/文章/图片/文档）与笔记——二者是 Agent 工具入库的用户资产，生命周期独立于会话
- 桌面端：修复资料库「文档」卡片点击无反应——ArtifactsPanel 此前仅在任务视图挂载，改为全局挂载（fixed 抽屉不占布局），html 走内置浏览器 iframe、md 走 Markdown 渲染
- 手机端：修复任务列表 SectionList 整组内容重复渲染、分组头图标与标题垂直堆叠的问题

### Changed (Previous)
- 整体布局重构（对齐 Codex）：左侧改为 78px 纯图标导航栏（Logo 置顶 + 任务 / 定时任务 / 资料库 / 技能包 / 设置），点击切换右侧视图；所有页面统一为左右分栏结构，左侧面板固定 260px，页面标题移至右侧区域靠左对齐
- 左侧面板标题行以 Logo 图标（迁移自 nexa-old）替代「Nexa」文字；Logo 顶部间距、面板顶部 64px 高度与全局拖动热区对齐
- 任务页移除搜索 / 筛选入口及相关逻辑；新建任务输入框固定于页面底部（外边距 24px）
- 各页面 aside 内独立的拖动热区移除，统一由全局顶部 drag-bar 覆盖

### Fixed
- 修复应用退出时 "Object has been destroyed" 崩溃：RelayClient 增加 destroyed 标志与 shutdown 清理，主进程状态回调增加 `mainWindow.isDestroyed()` 守卫，并在 `before-quit` 时关闭中继客户端
- 修复 nav-rail 内 Logo 因位于 drag-bar 节点导致 margin 不生效、以及 flex 容器固定高度压缩图标的问题（移除 drag-bar class、增加 shrink-0）

### Removed
- 移除根目录冗余的 `package.json` / `package-lock.json` / `node_modules`（remark-gfm 已在 nexa-desktop 内声明）

## [0.1.0] - 2026-10-14

六个里程碑全部交付。

### Added

**桌面端基础（M1–M3）**
- Electron 桌面应用骨架：主进程 / 渲染进程 / 预加载脚本三段式，sql.js（WASM）本地 SQLite，DELETE 日志模式，Schema 单文件内联
- 会话系统：自由任务与项目编码两种模式（分别绑定不同用户目录）、会话级联删除、历史会话恢复、项目上下文自动扫描（AGENTS.md / CLAUDE.md / README.md 注入系统 prompt）
- Agent Runtime：基于 pi-agent-core 的 Agent Loop，支持暂停 / 恢复 / 中止，消息发送与续跑状态事件即时推送
- 模型配置：DeepSeek / OpenAI / Anthropic 多 provider 卡片式设置，自定义 Base URL、启用开关、默认模型，运行中会话内手动切换模型
- 知识库与记忆（M4）：SQLite 粗筛 + LLM 重排的入库 / 召回流水线，三层记忆引擎（每 5 轮触发提取、0.8 相似度去重、按模式分层注入），设置页记忆管理面板
- 定时任务（M5a）：cron 调度核心（20s 轮询、防重入、失败自动停用），session_continuation / skill / script 三类任务，执行记录落库与桌面通知，管理面板 + schedule_* 五个 Agent 工具
- 技能包系统：目录式 Skill（`~/.nexa/skills/`）、子进程隔离执行（60s 超时、50KB 截断）、专家配置（内置三类 + YAML 自定义）、连接器（YAML 定义、`${secret:key}` 凭据解密、AES-256-GCM 主密钥），三分区管理页
- 首次启动三步引导向导；主题系统（system / light / dark）
- 全局窗口拖动体系与 macOS 交通灯避让

**中继与多端（M5b / M6）**
- `nexa-relay` 独立中继服务：6 位配对码（10 分钟有效、IP 限流）、双角色 WebSocket、心跳、重复连接踢旧、解绑清理，PM2 部署
- 桌面端中继客户端：设备身份管理、指数退避重连、手机端 RPC 分发（task:create、资料库搜索、页面采集等）与 Agent 事件回流，设置页手机配对 Tab（二维码 + 倒计时 + 在线状态）
- `nexa-mobile` Android 端：扫码配对、会话列表与轻量对话、资料库搜索
- `nexa-extension` Chrome MV3 插件：配对接入、右键收藏图片、页面采集入库、资料库搜索

**协议与资料库**
- `nexa-shared` 三端共享协议包：中继消息类型、数据结构、编解码校验、常量与提示词模板
- 桌面端资料库独立页面：文件 / 笔记双 Tab，笔记草稿 / 已提交两态、自动保存、分类标签管理
- 中继连接安全：非本地 http:// 地址配置警告，生产环境强制 wss

[Unreleased]: https://github.com/your-org/nexa-work/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-org/nexa-work/releases/tag/v0.1.0
