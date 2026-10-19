# Nexa Relay 中继服务

桌面端（Electron）与手机端之间的 WebSocket 配对与消息路由服务。中继只做配对鉴权与消息转发，**不存储任何业务内容**。

## 技术栈

- Node.js >= 18（ESM）
- Express 4（REST 接口）
- ws 8（WebSocket）
- PM2（生产进程守护）

## 目录结构

```
nexa-relay/
├── src/
│   ├── index.js        # 入口：HTTP + WS 服务、配对鉴权、消息路由、心跳
│   └── store.js        # 配对关系持久化（JSON 文件，防抖 200ms 落盘）
├── data/               # 运行时数据（relay-data.json，已 gitignore）
├── ecosystem.config.cjs# PM2 进程配置
└── package.json
```

## 本地开发

```bash
npm install
npm run dev      # node --watch，改动自动重启
# 默认监听 http://0.0.0.0:8787，WS 路径 /ws
```

健康检查：`GET /health` 返回 `{ ok, connections: { desktops, phones } }`。

## 生产部署（腾讯云 / Linux）

### 1. 环境与安装

```bash
# 主机需 Node.js 18+
node -v   # >= 18

# 拉取代码后安装生产依赖
cd nexa-relay
npm ci --omit=dev
```

### 2. PM2 守护

```bash
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # 按提示执行，实现开机自启
```

`ecosystem.config.cjs` 关键配置：

| 项 | 值 |
|---|---|
| name | `nexa-relay` |
| instances | 1 |
| autorestart | true |
| max_memory_restart | 200M |
| PORT | 8787 |

常用运维命令：

```bash
pm2 status
pm2 logs nexa-relay            # 查看 stdout/stderr
pm2 restart nexa-relay
pm2 stop nexa-relay && pm2 delete nexa-relay
```

### 3. 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8787` | HTTP/WS 监听端口 |
| `RELAY_DATA_DIR` | `<cwd>/data` | 配对数据文件目录，跨版本升级建议指向独立持久化路径 |
| `CODE_TTL_MS` | `600000`（10 分钟） | 配对码有效期 |

### 4. Nginx TLS 反代（wss）

桌面端在设置中填写 `https://<域名>`，客户端内部会推导 `wss://<域名>/ws`。Nginx 需正确透传 Upgrade 头：

```nginx
server {
    listen 443 ssl http2;
    server_name relay.example.com;

    ssl_certificate     /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

> REST 与 WS 同域，无需为 `/ws` 单独配置 location。证书可用 `certbot --nginx` 申请。

## 数据持久化

唯一持久化文件：`$RELAY_DATA_DIR/relay-data.json`，内容仅含：

- `pending[]`：待确认配对码（`{code, desktopId, desktopName, createdAt, expiresAt}`），启动与使用时自动清理过期项
- `pairings[]`：已确认配对（`{desktopId, desktopName, phoneId, phoneName, token, pairedAt}`），`token` 用于手机重连鉴权

**中继不存业务消息、不存会话内容**。升级/迁移只需保留该 JSON 文件即可保留已配对关系。

## 协议说明

### 配对（REST）

`POST /api/pairing` body `{deviceId, deviceName}` → `{code, expiresAt, ttlMs}`

- 6 位码，字母表 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（已剔除 0/O/1/I）
- 单 IP 限流 30 次/分钟
- 同一桌面同时只保留一个待确认码，重新生成即作废旧码

### WebSocket `/ws`

连接 query：`role=desktop|phone&deviceId=&name=`

- **桌面端**：长期在线，无鉴权
- **手机端首次**：附带 `code`，成功后下发 `token`
- **手机端重连**：附带 `token` + 自身 `deviceId`，双重校验

消息信封：`{ type, id?, timestamp, payload?, to?, sender?:{deviceId,name,role} }`

| type | 方向 | 说明 |
|---|---|---|
| `relay:hello` | 中继 → 端 | 握手：桌面端收到已配对列表；手机端收到 `token` 与对端信息 |
| `relay:paired` | 中继 → 桌面 | 新手机配对成功 |
| `relay:peer-online` / `relay:peer-offline` | 中继 → 对端 | 对端上下线 |
| `relay:unbind` | 桌面 → 中继 | 解绑指定手机，中继向手机发 `relay:unbound` 并以 `4000` 关闭连接 |
| `agent:event` / `scheduler:notify` | 桌面 → 手机 | Agent 事件流、定时任务通知 |
| `task:create` / `session:*` | 手机 → 桌面 | 手机端发起会话/续跑/查询 RPC，桌面端带 `id` 回包 |

心跳：服务端每 30s 发送协议级 ping，连续两个周期未收到 pong 则 `terminate()`。

## 常见问题

- **桌面端连上 35 秒后自动断开重连**：客户端发协议 ping 却等 JSON `relay:pong` 的 bug，已修复（监听原生 pong 帧）。若复现请确认客户端版本。
- **手机重连报 "重连 token 无效"**：该手机已被桌面端解绑，需重新扫码配对。
- **配对码扫码无效**：码 10 分钟过期或已被消费；桌面端重新生成即可。
- **查看当前连接数**：`curl http://127.0.0.1:8787/health`。
