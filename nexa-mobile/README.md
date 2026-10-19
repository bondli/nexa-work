# Nexa Mobile 手机端

Nexa 的 Android 客户端（React Native / Expo），通过中继服务与桌面端配对，实现远程发起任务、查看会话、续跑、接收 Agent 通知与资料库搜索。

## 技术栈

- Expo SDK 57 / React Native 0.86 / React 19
- Expo Router（文件路由 `src/app/`）
- Zustand（状态） + expo-secure-store（token / 中继地址加密存储）
- expo-camera（扫码配对）
- 内置 WebSocket 长连中继

## 目录结构

```
nexa-mobile/
├── src/
│   ├── app/                    # Expo Router 路由
│   │   ├── _layout.tsx         # Stack 根布局 + 初始化中继服务
│   │   ├── index.tsx           # 入口重定向（已配对→首页，否则→配对）
│   │   ├── pair.tsx            # 配对页（中继地址 + 6 位码 / 扫码）
│   │   ├── home.tsx            # 首页（电脑状态 + 会话列表 + 新建任务）
│   │   ├── library.tsx         # 资料库搜索页
│   │   └── session/[id].tsx    # 会话详情（消息流 + 发送）
│   └── lib/relay/
│       ├── protocol.ts         # 中继消息类型与常量
│       ├── client.ts           # WS 客户端（配对/重连/心跳/RPC）
│       ├── storage.ts          # expo-secure-store 封装 + 设备 ID
│       └── service.ts          # 客户端单例 + Zustand store
├── android/                    # prebuild 生成的原生工程（.gitignore）
├── app.json
├── eas.json
└── package.json
```

## 开发

```bash
npm install
npm start              # 启动 Metro，用 Expo Go 扫码运行
npm run android        # 连接 Android 设备/模拟器运行
npm run typecheck      # 类型检查
```

## 配对流程

1. 桌面端 Nexa → 设置 → 手机配对 → 保存中继地址 → 生成配对码（二维码 + 6 位码）
2. 手机端配对页填写相同中继地址，手动输码或点「扫码」识别二维码
3. 连接成功后桌面端会显示该手机在线，手机端跳转首页

中继二维码内容为 `nexa://pair?url=<relayUrl>&code=<6位码>`。

## 本地打包 APK

本项目仅使用本地打包，不启用 EAS 云端构建。

### 前置条件

- JDK 17（`java -version` 确认）
- Android SDK（设置 `ANDROID_HOME` 环境变量）
- 首次构建会自动下载 Gradle 和依赖，需联网

### 步骤

```bash
# 1. 生成原生 Android 工程（首次或 app.json 变更后需要）
npm run prebuild:android

# 2. 编译 Release APK
npm run build:android
# 产物路径: android/app/build/outputs/apk/release/app-release.apk

# 或编译 Debug APK（更快，带调试日志）
npm run build:android-debug
# 产物路径: android/app/build/outputs/apk/debug/app-debug.apk
```

### 安装到设备

```bash
# USB 连接手机（开启 USB 调试）
adb install android/app/build/outputs/apk/release/app-release.apk
```

### 重新生成原生工程

当 `app.json` 变更（如改包名、加权限）或 Expo SDK 升级后，需重新 prebuild：

```bash
rm -rf android/              # 删除旧工程
npm run prebuild:android     # 重新生成
```

> `android/` 目录已加入 `.gitignore`，不要手动提交。每次 prebuild 都会根据 `app.json` 重新生成。

### 常见问题

| 问题 | 解决 |
|------|------|
| `SDK location not found` | 设置 `ANDROID_HOME` 环境变量指向 Android SDK 路径 |
| `Java version incompatible` | 确保 JDK 17，不用 JDK 21+ |
| `Gradle build failed` | 删除 `~/.gradle/caches/` 后重试 |
| `prebuild` 报 expo 未安装 | 先 `npm install` 再 `npx expo prebuild` |
| 改了 app.json 不生效 | `rm -rf android/ && npm run prebuild:android` |

## 中继协议

与桌面端 / nexa-relay 严格一致：

- WS `ws://<中继>/ws?role=phone&deviceId=&name=&code=`（首次）或 `&token=`（重连）
- 信封 `{ type, id?, timestamp, payload?, to?, sender? }`
- 心跳：客户端发 `relay:ping`，中继回 `relay:pong`，超时未回则重连
- 手机 → 桌面 RPC：`task:create` / `session:send` / `session:list` / `session:messages` / `library:search`
- 桌面 → 手机广播：`agent:event`（会话流式事件）、`scheduler:notify`（定时任务通知）
- 桌面解绑：中继向手机发 `relay:unbound` 并以 `4000` 关闭连接，手机端自动清空 token 回到配对页

## 数据存储（expo-secure-store）

| Key | 说明 |
|---|---|
| `nexa.relay.token` | 配对重连 token |
| `nexa.relay.url` | 中继服务器地址 |
| `nexa.device.id` | 本机设备 ID（`phone-<uuid>`） |
