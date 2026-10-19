# Nexa 浏览器插件

Chrome MV3 扩展，通过 Nexa 中继服务连接桌面端，为浏览器提供三项能力：

| 能力 | 说明 |
|------|------|
| **采集此页面** | 一键把当前网页（URL + 标题 + 完整 HTML）发送到桌面端，由 `KnowledgeBaseService.ingestArticle` 入库。桌面端直接使用插件提供的 HTML，不会再次抓取，因此能正确处理登录态 / 反爬页面。 |
| **收藏图片** | 图片右键菜单「Nexa 收藏图片」，将图片以 base64 发送到桌面端，保存到 `~/.nexa/library/images/` 并建立知识库条目。 |
| **快速搜索** | Popup 搜索框实时搜索桌面端资料库（`KnowledgeBaseService.search`，返回 top 8）。 |

---

## 目录结构

```
nexa-extension/
├── manifest.json              # MV3 清单（产物路径已扁平化，指向 dist/ 根）
├── package.json               # 构建依赖（typescript / esbuild / @types/chrome）
├── tsconfig.json
├── scripts/
│   └── build.mjs              # esbuild 构建脚本（输出到 dist/）
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── src/
│   ├── background.ts          # Service Worker：WS 连接、右键菜单、消息分发
│   ├── relay-client.ts        # 中继 WS 客户端（配对 / 重连 / 心跳 / RPC）
│   ├── popup.html             # 弹窗页面
│   ├── popup.ts               # 弹窗逻辑：状态 / 采集 / 搜索
│   ├── options.html           # 配对设置页
│   └── options.ts             # 配对逻辑
└── dist/                      # 构建产物（加载扩展时选择此目录）
    ├── manifest.json
    ├── background.js          # esbuild 输出（ESM，对应 manifest type:module）
    ├── popup.js / options.js  # esbuild 输出（IIFE）
    ├── popup.html / options.html
    └── icons/
```

> 源码使用 TypeScript，**需要先构建**再加载扩展。构建产物位于 `dist/`。

---

## 前置条件

- **Chrome ≥ 110**（MV3 + Service Worker ES Module 支持）
- **Nexa 中继服务**已启动（默认 `http://localhost:8787`，或你的部署地址）
- **Nexa 桌面端**已启动并已连接到同一中继

---

## 安装与配对

### 1. 构建扩展

```bash
cd nexa-extension
npm install        # 首次安装依赖
npm run build      # 构建产物到 dist/
```

> 开发模式可用 `npm run dev` 监听源码变更增量构建。

### 2. 加载扩展

1. 打开 Chrome，地址栏输入 `chrome://extensions`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择构建产物目录 `nexa-extension/dist/`

加载成功后工具栏出现 Nexa 图标。

### 3. 获取配对码

1. 打开 Nexa 桌面端 → **设置 → 手机配对**
2. 点击「生成配对码」，得到一个 6 位码（10 分钟有效，一次性）

### 4. 插件配对

1. 点击工具栏 Nexa 图标打开 Popup
2. 点击底部 **配对设置**
3. 填入：
   - **中继服务器地址**：如 `http://localhost:8787`（本地）或你的中继部署地址
   - **配对码**：桌面端生成的 6 位码
4. 点击 **配对并连接**

配对成功后 Popup 顶部状态点变为绿色，显示「电脑 在线」。

> 插件作为「phone」角色接入中继，配对后会出现在桌面端「已配对设备」列表中，名称为「Chrome 插件」。

---

## 使用

### 采集网页

1. 打开任意网页
2. 点击 Nexa 图标 → **采集此页面到资料库**
3. 成功后弹出 Toast，桌面端资料库新增一条 `article` 类型记录

### 收藏图片

1. 在任意网页上 **右键点击图片**
2. 选择 **Nexa 收藏图片**
3. 桌面端收到通知，图片保存到 `~/.nexa/library/images/`

### 搜索资料库

1. 点击 Nexa 图标
2. 在「快速搜索资料库」输入框输入关键词（350ms 防抖）
3. 实时显示匹配的知识库条目

---

## 架构与数据流

```
┌─────────────────────────────┐
│  Chrome 扩展                 │
│  role=phone                 │
│  deviceId=plugin-<uuid>     │
└──────────────┬──────────────┘
               │  WS 信封（与手机端协议完全一致）
               ▼
┌─────────────────────────────┐
│  nexa-relay (默认 :8787)     │
│  按配对关系单播到桌面端        │
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│  nexa-desktop               │
│  RelayClient.dispatchFromPhone │
│  ├─ library:ingest-article  │  → knowledgeBase.ingestArticle
│  ├─ library:favorite-image  │  → 写盘 + knowledgeBase.ingestImage
│  └─ library:search          │  → knowledgeBase.search
└─────────────────────────────┘
```

### 消息协议

请求信封：`{ type, id, timestamp, payload }`
响应信封：回同 `type`，`to` 设为发送方 `deviceId`（中继按 `to` 单播）。

| type | payload | 响应 payload |
|------|---------|--------------|
| `library:ingest-article` | `{ url: string, html?: string, title?: string }` | `{ ok: boolean, id?: string, title?: string, duplicate?: boolean }` |
| `library:favorite-image` | `{ url: string, data: string (base64), mimeType?: string }` | `{ ok: boolean, id?: string }` |
| `library:search` | `{ query: string }` | `Array<{ id, title, summary, type }>` |

错误响应：`type: "relay:error"`, `payload: { message, refType }`。

### 配对与重连机制

- **首次配对**：插件用 `code` 连接中继，中继校验后下发 `token`（48 hex），插件存入 `chrome.storage.local`
- **重连**：Service Worker 唤醒后读取存储的 `token` + `relayUrl` + `deviceId`，自动重连
- **心跳**：每 25s 发送 `relay:ping`，10s 内未收到 `relay:pong` 则主动断开重连
- **退避重连**：`[1s, 2s, 5s, 10s, 30s]` 递增，上限 30s
- **解绑**：桌面端在「手机配对」中删除该设备 → 中继发 `relay:unbound` → 插件清除本地 token

---

## 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 持久化配对 token、中继地址、设备 ID（`chrome.storage.local`） |
| `activeTab` | 采集当前活动标签页的 DOM |
| `scripting` | 通过 `chrome.scripting.executeScript` 注入页面获取 `outerHTML` |
| `contextMenus` | 注册「Nexa 收藏图片」右键菜单项 |
| `downloads` | 预留（图片通过 base64 直接发送，未实际调用下载 API） |
| `notifications` | 收藏成功 / 失败的桌面通知 |
| `host_permissions: <all_urls>` | 采集任意网页内容 + 下载任意图片 |

---

## 开发与调试

### 重新加载修改

修改源码后重新构建（或保持 `npm run dev` 运行），再到 `chrome://extensions` 找到 Nexa 卡片点击 **刷新** 图标（⟳）。

### 调试 Service Worker

1. `chrome://extensions` → Nexa 卡片 → **Service Worker** 链接
2. 打开 DevTools，Console 查看日志，Network 查看 WS 帧

### 调试 Popup

1. 右键 Nexa 图标 → **检查弹窗**
2. 打开 Popup DevTools

### 调试 Options 页

在 Options 页右键 → **检查**。

### 查看中继连接状态

Popup 顶部状态点：

| 状态 | 含义 |
|------|------|
| 🟢 绿色 +「电脑 在线」 | 已连中继且桌面端在线 |
| ⚪ 灰色 +「已连中继，桌面离线」 | WS 已通，但桌面端未上线 |
| ⚪ 灰色 +「未连接」 | 未配对或 WS 断开 |

---

## 数据存储

所有状态存储在 `chrome.storage.local`：

| key | 内容 |
|-----|------|
| `nexa.relay.token` | 配对 token（48 hex） |
| `nexa.relay.url` | 中继服务器地址 |
| `nexa.plugin.deviceId` | 设备 ID（`plugin-<uuid>`，首次启动生成） |

清除方式：`chrome://extensions` → Nexa → **详情** → **清除数据**，或在 Options 页重新配对（旧 token 自动失效）。

---

## 常见问题

**Q: 配对失败，提示「配对码无效」**
A: 配对码一次性使用且 10 分钟过期。请在桌面端重新生成，确保大小写一致（插件会自动转大写）。

**Q: 状态显示「已连中继，桌面离线」**
A: 中继服务正常但桌面端未连接。请确认桌面端 Nexa 已启动，且其「设置 → 中继」地址与插件填写的一致。

**Q: 采集失败，提示「桌面端未连接」**
A: 同上，桌面端离线时插件无法入库。请先确保桌面端在线。

**Q: 收藏图片无反应**
A: 检查是否授予了 `notifications` 权限，或查看 Service Worker Console 报错。图片需可被 `fetch` 访问（跨域图片可能受 CORS 限制）。

**Q: 如何更换中继地址？**
A: 打开配对设置页，修改中继地址后点击「配对并连接」即可，无需重新生成配对码（token 仍然有效）。

**Q: 手机和插件能同时配对吗？**
A: 可以。两者都作为 `phone` 角色接入，桌面端会为每个设备建立独立配对关系，互不干扰。

---

## 安全

- 配对 token / 中继地址存储在 `chrome.storage.local`（扩展隔离存储）
- 配对码一次性、10 分钟有效（由中继强制）
- 插件仅以 `phone` 角色接入，**不能向其他设备广播**，中继将其所有消息单播到已配对的桌面端
- 图片数据通过 base64 在 WS 中传输，不经过第三方
- 建议生产环境中继使用 HTTPS / WSS
