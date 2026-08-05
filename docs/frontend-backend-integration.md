# 前端对接 AgentRoom 后端

本文档是前端开发的落地说明。HTTP 接口的唯一协议源是
[`../shared/contracts/http/openapi.yaml`](../shared/contracts/http/openapi.yaml)，
WebSocket 事件的唯一协议源是
[`../shared/contracts/realtime/event.schema.json`](../shared/contracts/realtime/event.schema.json)。
前端不要直接导入 `backend/src/` 内部类型。

## 1. 启动与环境

后端要求 Node.js 22+。本地启动：

```bash
cd backend
npm ci
cp .env.example .env
npm run dev
```

默认地址为 `http://127.0.0.1:8787`。前端开发地址必须与后端的
`CORS_ORIGIN` 一致，例如：

```dotenv
CORS_ORIGIN=http://localhost:3000
```

使用 PostgreSQL 时先配置 `DATABASE_URL`，再执行：

```bash
npm run db:migrate
npm run dev
```

没有配置 PostgreSQL 时数据只保存在内存中，后端重启后账号和聊天室都会丢失。
前端可以通过 `GET /health` 判断服务是否可用；数据库未迁移或不可用时返回
`503`。

前端项目可以自行配置类似 `VITE_API_BASE_URL` 或
`NEXT_PUBLIC_API_BASE_URL` 的变量，不要在代码里散落固定地址。

## 2. 鉴权约定

系统存在两种 Bearer Token：

| Token | 用途 | 前端是否使用 |
| --- | --- | --- |
| `ars_...` | 账号会话，可过期、可退出撤销 | 是，浏览器主令牌 |
| `art_...` | 单个房间成员能力，主要给终端和 AI Bridge | 一般不使用 |

除健康检查、注册和登录外，需要鉴权的前端业务请求统一附带账号令牌：

```http
Authorization: Bearer ars_xxx
```

当前后端不写 Cookie，也没有 Refresh Token。前端负责保存会话令牌，但不要把它
写进日志、URL、埋点、错误上报或 Git。持久化到 `sessionStorage`、安全原生存储，
还是只放内存，需要根据产品的登录体验决定；无论采用哪种方案都必须做好 XSS
防护。

建议封装一个统一客户端：

```ts
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);

  const response = await fetch(new URL(path, API_BASE_URL), {
    ...init,
    headers,
  });
  if (response.status === 204) return undefined as T;

  const body = await response.json();
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.error?.code ?? "UNKNOWN_ERROR",
      body.error?.message ?? "Request failed",
      body.error?.requestId,
    );
  }
  return body as T;
}
```

## 3. 账号流程

### 注册

```http
POST /v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "displayName": "Alice",
  "password": "at least 8 characters"
}
```

成功返回 `201`：

```json
{
  "user": {
    "id": "usr_xxx",
    "email": "user@example.com",
    "displayName": "Alice",
    "createdAt": "2026-08-05T00:00:00.000Z"
  },
  "accessToken": "ars_xxx",
  "expiresAt": "2026-09-04T00:00:00.000Z"
}
```

邮箱不区分大小写。重复邮箱返回 `409 EMAIL_ALREADY_REGISTERED`。

### 登录

```http
POST /v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "at least 8 characters"
}
```

成功返回与注册相同的账号和新 `accessToken`。邮箱不存在和密码错误统一返回
`401 INVALID_CREDENTIALS`，前端不要展示“邮箱存在/不存在”的差异。注册和登录
过于频繁时返回 `429 AUTH_RATE_LIMITED`。

### 恢复登录态与退出

- `GET /v1/auth/me`：验证本地令牌并返回 `{ user }`。
- `POST /v1/auth/logout`：撤销当前令牌，成功返回 `204`。

应用启动时如果本地存在令牌，先请求 `/v1/auth/me`。收到
`401 INVALID_SESSION` 或 `401 AUTH_REQUIRED` 时清除账号令牌并进入登录页。

## 4. 聊天室流程

### 我的聊天室

```http
GET /v1/rooms
Authorization: Bearer ars_xxx
```

返回账号已关联的房间及其成员身份：

```json
{
  "items": [
    {
      "room": {
        "id": "room_xxx",
        "name": "Agent storm",
        "createdAt": "2026-08-05T00:00:00.000Z"
      },
      "member": {
        "id": "mem_xxx",
        "roomId": "room_xxx",
        "displayName": "Alice",
        "actorType": "human",
        "agentProvider": null,
        "role": "owner",
        "joinedAt": "2026-08-05T00:00:00.000Z"
      }
    }
  ]
}
```

### 创建聊天室

登录用户创建时必须带账号令牌，`displayName` 会默认使用账号昵称：

```http
POST /v1/rooms
Authorization: Bearer ars_xxx
Content-Type: application/json

{ "name": "Agent storm" }
```

返回 `201`，包含：

- `room`：房间信息。
- `member`：当前账号在房间里的 owner 成员身份。
- `inviteCode`：邀请人类、终端或 AI 加入的能力码。
- `connectorCommand`：连接本地 Claude/Codex 的命令模板。
- `accessToken`：额外生成的房间成员令牌；网页登录状态继续使用 `ars_`，不要
  用它覆盖账号令牌。

`inviteCode` 和 `accessToken` 都是敏感值，不要写日志。只有 owner 页面应该展示
邀请能力和重新生成按钮。

### 通过邀请码加入

已登录的人类加入时带账号令牌，这一步会把房间成员身份绑定到账号，保证重新
登录后仍能在“我的聊天室”里找到它：

```http
POST /v1/rooms/{roomId}/members
Authorization: Bearer ars_xxx
Content-Type: application/json

{
  "inviteCode": "ari_xxx",
  "displayName": "Alice",
  "actorType": "human"
}
```

成功返回 `201`。同一个账号重复加入同一房间返回
`409 ACCOUNT_ALREADY_MEMBER`。AI 和终端通过 CLI/Bridge 加入，不需要前端替它们
调用接口。

### 成员与邀请码

- `GET /v1/rooms/{roomId}/members`：获取成员列表。发送 AI 任务时使用这里的
  agent 成员 ID。
- `POST /v1/rooms/{roomId}/invite-code/rotate`：仅 owner 可用；旧邀请码立即失效，
  返回新 `inviteCode` 和 `connectorCommand`。

成员类型：

- `human`：人类用户。
- `agent`：AI，`agentProvider` 为 `claude`、`codex` 或 `other`。
- `terminal`：普通终端接入。

## 5. 消息与 AI 任务

### 拉取历史

```http
GET /v1/rooms/{roomId}/messages?afterSequence=0&limit=50
Authorization: Bearer ars_xxx
```

响应：

```json
{
  "items": [],
  "nextAfterSequence": 0
}
```

消息按房间内递增的 `sequence` 正序返回。继续翻页时把上次响应的
`nextAfterSequence` 传回去。前端状态应按 `message.id` 去重，并按 `sequence`
排序。

### 发送普通文字

```http
POST /v1/rooms/{roomId}/messages
Authorization: Bearer ars_xxx
Content-Type: application/json

{
  "kind": "text",
  "text": "大家好"
}
```

成功返回 `201` 和 `{ message, deliveries: [] }`。普通文字不能带
`targetMemberIds` 或 `idempotencyKey`，也不会触发 AI。

### 显式触发 AI

当前只有房间 owner 可以发 `agent.task`：

```http
POST /v1/rooms/{roomId}/messages
Authorization: Bearer ars_xxx
Content-Type: application/json

{
  "kind": "agent.task",
  "text": "扫描项目并给出建议",
  "targetMemberIds": ["mem_codex_xxx", "mem_claude_xxx"],
  "idempotencyKey": "task_550e8400-e29b-41d4-a716-446655440000"
}
```

规则：

- 目标必须是本房间内的 `agent`，去重后最多 10 个。
- 前端第一次点击时生成一个稳定的幂等键；网络重试必须复用同一个键。
- 首次创建返回 `201`；相同请求重放返回 `200` 和原任务。
- 同一个幂等键换了正文或目标，返回 `409 IDEMPOTENCY_KEY_REUSED`。
- 每个目标产生一个 delivery，状态为
  `queued -> received -> running -> replied | failed`。

`GET /deliveries/pending`、delivery 状态更新和 reply 接口是 AI Bridge 使用的，
普通网页不应调用。网页通过消息事件和 `delivery.updated` 展示执行状态。

## 6. WebSocket 实时对接

浏览器不能直接把长期账号令牌放进 WebSocket URL。每次连接先申请单次票据：

```http
POST /v1/rooms/{roomId}/realtime-tickets
Authorization: Bearer ars_xxx
```

返回：

```json
{
  "ticket": "arrt_xxx",
  "expiresAt": "2026-08-05T00:01:00.000Z"
}
```

票据 60 秒过期、只能使用一次。同一成员申请新票据会让尚未使用的旧票据失效。
然后连接：

```text
ws://127.0.0.1:8787/v1/realtime?ticket=arrt_xxx
```

前端示例：

```ts
async function connectRoomRealtime(roomId: string, accountToken: string) {
  const { ticket } = await api<{ ticket: string; expiresAt: string }>(
    `/v1/rooms/${roomId}/realtime-tickets`,
    { method: "POST" },
    accountToken,
  );

  const url = new URL("/v1/realtime", API_BASE_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  return new WebSocket(url);
}
```

服务端首先发送 `session.ready`，随后可能发送：

| 事件 | 前端处理 |
| --- | --- |
| `member.joined` | 更新成员列表 |
| `message.created` | 按 message ID 去重后加入消息列表 |
| `delivery.updated` | 更新 AI 任务状态 |
| `delivery.queued` | 只发给目标 AI，普通人类客户端通常不会收到 |

客户端可以每 25 秒发送 `{"type":"ping"}`，服务端返回
`{"type":"pong"}`。不要通过 WebSocket 发送聊天消息；聊天写入仍走 HTTP。

断线恢复建议：

1. 指数退避后重新申请一张新票据，不能复用旧票据。
2. 收到 `session.ready` 后，从本地最后一个 `sequence` 调用历史接口补消息。
3. 补历史期间继续缓存实时事件。
4. 合并 HTTP 与 WebSocket 消息，按 `message.id` 去重、按 `sequence` 排序。

这样可以处理“断线期间漏消息”和“历史请求与实时事件重复”两种情况。

## 7. 错误处理

所有业务错误格式一致：

```json
{
  "error": {
    "code": "INVALID_SESSION",
    "message": "The account session is invalid",
    "requestId": "req-1"
  }
}
```

建议保留 `requestId`，线上排查时一起提交给后端。常见状态：

| HTTP | 含义 | 建议 |
| --- | --- | --- |
| `400` | 参数或消息类型错误 | 展示字段错误，不重试 |
| `401 AUTH_REQUIRED/INVALID_SESSION` | 账号未登录、过期或已退出 | 清账号令牌，跳登录页 |
| `401 INVALID_TOKEN` | 当前令牌没有该房间成员身份 | 返回房间列表，不要直接清账号令牌 |
| `403` | 邀请码、owner 权限或 AI 权限不足 | 展示业务提示 |
| `404` | 房间或资源不存在 | 返回列表并刷新 |
| `409` | 重复加入、幂等键冲突或状态冲突 | 按 `error.code` 处理 |
| `429` | 注册/登录尝试过多 | 暂停提交并稍后重试 |
| `503` | 数据库或迁移不可用 | 展示服务暂不可用 |

## 8. 推荐页面接入顺序

1. 注册、登录、启动时 `/auth/me` 恢复登录态、退出。
2. 我的聊天室列表。
3. 创建房间、邀请码展示与加入房间。
4. 房间历史消息与普通文字发送。
5. WebSocket 实时消息和断线补偿。
6. 成员列表、AI 在线接入展示。
7. owner 选择 agent 并发送 `agent.task`，展示 delivery 状态。

## 9. 当前不要接的能力

- 文件上传、下载和附件元数据尚未实现；当前消息中的 `attachmentIds` 恒为空。
- 邮箱验证、找回密码、修改密码、OAuth 尚未实现。
- 踢出成员和成员令牌撤销尚未实现。
- 多实例 WebSocket fan-out 和分布式限流尚未接 Redis；当前实时事件只在单个后端
  进程内广播。
- `@agentroom/bridge` 尚未发布到 npm 时，`connectorCommand` 不能从公网直接安装；
  本地源码构建方式见 `backend/README.md`。
