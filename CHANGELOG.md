# 更新日志

本文件记录 Nexa 每次修改的重要内容。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

### Added
- 通用设置新增「字体大小」选项（12/14/16px，持久化到 settings.chatFontSize），经 `--chat-font-size` CSS 变量仅作用于会话消息内容
- 会话消息流末尾新增「生成的产物」文件卡（Markdown/HTML/PDF 等文档类文件），点击直达右侧产物面板并自动展开父目录定位预览（artifacts-store 新增 openArtifact）
- 本地实现 shadcn ai-elements 组件（Conversation / Message / MessageContent / Response / Tool / PlanCard，API 对齐官方），消息展示统一组件化、降低维护成本

### Changed
- 设置弹框模型配置独立为「模型」tab（通用 tab 仅保留外观/字体）；弹框固定高度 640px，滚动收敛在右侧内容区，切换 tab 高度不再抖动；移除左下角常驻的「修改即保存」提示（自动保存成功/失败反馈保留在模型 tab 标题行）
- 设置由全页视图改为全局弹框：ui-store 以 settingsOpen 控制开关，新增 ui/dialog（Radix Dialog）与 settings-dialog，移除 settings-page 与 ActiveView 的 "settings" 分支
- 模型配置改为「修改即保存」：字段变更后 600ms 防抖自动持久化，移除保存按钮，保存成功/失败反馈展示在模型 tab 标题行
- shadcn/ui 组件化推进：新增 Card / Badge / Avatar / Input，设置弹框 provider 卡片与知识库/记忆条目、欢迎页模式选择卡、nav-rail 用户头像等完成迁移
- MarkdownRenderer 与消息气泡字号跟随 `--chat-font-size`

### Fixed
- 修复顶部全局拖动覆盖层（fixed h-16 z-70）遮挡页面顶栏按钮点击的问题：移除全局兜底层，改由 nav-rail Logo 容器自带 drag-bar 承担拖动
- Tailwind v4 preflight 将 button 光标重置为 default，global.css 统一为可点击元素恢复手型光标（disabled 为 not-allowed）
- nav-rail 用户头像圆形背景加深（bg-foreground/15 + 内描边），深浅色主题下均清晰可见
- 修复 runtime.generateTitleAsync：getApiKey 可返回 undefined 导致编译失败（provider 禁用/未配 key 时跳过标题生成）

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
