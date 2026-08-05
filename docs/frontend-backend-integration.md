# 前端对接 AgentRoom 后端

本文档同时说明产品背景和前端开发的落地方式。HTTP 接口的唯一协议源是
[`../shared/contracts/http/openapi.yaml`](../shared/contracts/http/openapi.yaml)，
WebSocket 事件的唯一协议源是
[`../shared/contracts/realtime/event.schema.json`](../shared/contracts/realtime/event.schema.json)。
前端不要直接导入 `backend/src/` 内部类型。

## 0. 产品背景

### AgentRoom 是什么

AgentRoom 是一个允许人类、本地终端和 AI Agent 共同参与的网页聊天室。它解决的
不是“多人共享同一个终端”，而是让多个用户的多个终端、Claude、Codex 等独立
执行环境进入同一个房间，通过统一消息协议交换上下文、任务、状态和回复。

典型场景：

1. 用户在网页注册并创建一个聊天室。
2. 房间生成邀请码和本地连接命令。
3. 用户或协作者在各自电脑、各自项目目录运行 AgentRoom Bridge。
4. Bridge 将本地 Claude/Codex 作为独立 agent 成员加入房间。
5. 网页展示当前已注册的人类、终端和 agent。
6. 人类可以正常聊天，也可以明确选择一个或多个 agent 下发任务。
7. 本地 agent 在自己的工作区执行，通过 Bridge 回传状态和最终结果。

整体关系如下：

```text
浏览器 A ───────────────┐
浏览器 B ───────────────┤
                       ├── HTTP + WebSocket ── AgentRoom 后端 ── PostgreSQL
本地 Bridge ── Claude ──┤
本地 Bridge ── Codex ───┘
```

后端是协作控制面和消息中枢，不会把不同用户的 Shell 合并成一个终端，也不会直接
登录或托管用户的 Claude/Codex 账号。AI 推理仍发生在用户本机，Bridge 使用本机
已有的 Claude/Codex 登录状态和项目目录。

### 主要参与者

| 参与者 | 说明 | 前端主要展示 |
| --- | --- | --- |
| 账号 `user` | 可注册、登录的人类身份 | 个人信息、我的聊天室 |
| 人类成员 `human` | 某个账号在具体房间里的身份 | 昵称、owner/member 角色 |
| AI 成员 `agent` | 通过 Bridge 加入的 Claude、Codex 或其他 AI | provider、任务执行状态 |
| 终端成员 `terminal` | 加入房间但不代表 AI 的本地终端 | 终端身份和消息 |
| Bridge | 本地常驻连接器，负责接收任务并驱动 AI | 安装命令、连接说明 |

一个账号可以加入多个房间，并且在不同房间拥有不同的成员 ID 和角色。因此前端
不能用 `user.id` 替代 `member.id`。消息作者、AI 任务目标和 WebSocket 会话都使用
房间内的 `member.id`。

### 核心产品规则

这些规则会直接影响 UI 和交互设计：

- 房间 ID 只是公开路由信息，不是密码；访问房间仍然需要账号成员身份、成员令牌
  或邀请码。
- 普通 `text` 消息只进入聊天记录，绝不会自动唤醒 AI。
- 只有明确的 `agent.task` 才会触发 AI，并且必须选择具体 agent 成员。
- 当前只有房间 owner 可以触发 agent，避免加入房间的人随意控制别人的本地终端。
- 一个任务可以同时发给多个 agent；每个 agent 都有独立 delivery 和状态。
- agent 的最终回复是普通可见消息，不会自动继续触发另一个 agent。Agent 之间继续
  协作需要人类或 owner 再创建一个明确任务。
- 成员出现在列表里只表示“已经加入过房间”，不表示此刻在线。当前还没有 presence
  心跳接口，前端不要仅凭成员列表或 `member.joined` 显示绿色在线状态。
- Bridge 必须在用户本机运行，离线的 Bridge 不会立即处理任务；任务会保留为待处理
  delivery，Bridge 恢复连接后再拉取。
- 聊天消息以 PostgreSQL 为最终事实来源，WebSocket 用于低延迟通知；断线后必须通过
  HTTP 历史接口补齐。

### 当前 MVP 边界

当前后端已经完成账号、房间、成员、文字消息、AI 任务投递、Claude/Codex Bridge、
PostgreSQL 持久化和单进程实时消息。产品目标中的文件共享会支持各种文件，但上传、
对象存储、扫描和下载授权尚未实现，所以当前前端先完成纯文字与 AI 协作流程。

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

线上后端统一通过以下基址访问，根域名 `/` 留给前端页面：

```dotenv
VITE_API_BASE_URL=https://try-status.online/api
```

因此健康检查为 `GET https://try-status.online/api/health`，其他接口例如注册为
`POST https://try-status.online/api/v1/auth/register`，WebSocket 为
`wss://try-status.online/api/v1/realtime`。前端不要直接请求线上根路径下的
`/health` 或 `/v1/*`。

联调时可直接打开 Swagger UI：

- `https://try-status.online/api/docs`：可交互接口文档。
- `https://try-status.online/api/openapi.yaml`：原始 OpenAPI 3.1 协议文件。

使用 PostgreSQL 时先配置 `DATABASE_URL`，再执行：

```bash
npm run db:migrate
npm run dev
```

没有配置 PostgreSQL 时数据只保存在内存中，后端重启后账号和聊天室都会丢失。
前端可以通过相对于 API 基址的 `GET /health` 判断服务是否可用；数据库未迁移或
不可用时返回 `503`。

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
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "");

function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

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

  const response = await fetch(apiUrl(path), {
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
- `connector`：结构化 CLI 信息，其中 `command` 新建会话，`attachCommand` 绑定已有
  会话，`installers` 提供 macOS/Linux 与 Windows 安装器。
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

### 网页里的 AgentRoom CLI 面板

房间 owner 页面需要提供“连接 Agent”入口。不要在前端手工拼 CLI 命令，直接获取
后端根据部署地址生成的结构化信息：

```http
GET /v1/rooms/{roomId}/connector
Authorization: Bearer ars_xxx
```

响应：

```json
{
  "connectorCommand": "agentroom join room_xxx --base-url \"https://try-status.online/api\"",
  "connector": {
    "command": "agentroom join room_xxx --base-url \"https://try-status.online/api\"",
    "attachCommand": "agentroom attach room_xxx --base-url \"https://try-status.online/api\"",
    "distribution": "direct-download",
    "installers": {
      "manifestUrl": "https://try-status.online/api/downloads/cli/manifest.json",
      "macosLinuxUrl": "https://try-status.online/api/downloads/cli/install.sh",
      "windowsUrl": "https://try-status.online/api/downloads/cli/install.ps1"
    },
    "packageName": "@agentroom/bridge",
    "nodeVersion": ">=22",
    "supportedProviders": ["claude", "codex"]
  }
}
```

创建房间和旋转邀请码的响应中也包含相同的 `connector` 对象。
`connector.command` 用于创建新的 Agent 会话，`connector.attachCommand` 用于绑定
本机已有的 Claude/Codex 会话；`connectorCommand` 只为兼容已有调用保留。

建议面板内容：

1. 提示用户先安装 Node.js 22+，以及已经登录的 Claude Code 或 Codex CLI。
2. 根据浏览器平台提供“下载 macOS/Linux 安装器”和“下载 Windows 安装器”；链接
   必须直接使用 `connector.installers`，不要前端手拼。
3. 安装完成后提示用户按安装器输出完成 PATH 配置，再在终端 `cd` 到希望 AI 操作的
   项目目录。
4. 提供“新会话加入”和“已有会话加入”两个复制按钮，分别复制
   `connector.command` 与 `connector.attachCommand`。
5. 邀请码单独显示和复制；CLI 会在终端里交互式询问邀请码、provider 和昵称。
6. 展示 Claude/Codex 两种 provider 的状态说明，但不要把邀请码追加进命令参数，
   避免秘密进入 Shell 历史。
7. CLI 加入成功后会把成员令牌写入项目内被 Git 忽略的 `.agentroom/` 私有配置。
   `attach` 会让 Codex 选择当前工作区的历史 thread；Claude 会配置本地 MCP 并输出
   带 Channel 参数的原会话恢复命令。
8. 连接后根据 `member.joined` 或重新拉取成员列表显示新 agent；在 presence 上线前
   使用“已加入”，不要显示“在线”。

服务器不会保存邀请码明文，所以页面刷新后 `GET /connector` 只能重新获得非秘密
命令，不能取回原邀请码。如果 owner 已经丢失邀请码，按钮应写成“生成新邀请码”，
调用 `POST /invite-code/rotate`，并明确提示旧邀请码会立即失效。

网页只负责下载安装器和复制 CLI，不应尝试从浏览器直接启动本地进程。CLI 由后端
直接提供，不依赖 npm。安装器、单文件 bundle 和 SHA-256 清单位于
`/downloads/cli/`。

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
wss://try-status.online/api/v1/realtime?ticket=arrt_xxx
```

前端示例：

```ts
async function connectRoomRealtime(roomId: string, accountToken: string) {
  const { ticket } = await api<{ ticket: string; expiresAt: string }>(
    `/v1/rooms/${roomId}/realtime-tickets`,
    { method: "POST" },
    accountToken,
  );

  const url = new URL(apiUrl("/v1/realtime"));
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
- CLI 要求 Node.js 22+；安装器不会自动安装 Node.js、Claude Code 或 Codex CLI。
