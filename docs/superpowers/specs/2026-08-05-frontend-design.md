# AgentRoom 前端设计

日期：2026-08-05
状态：已确认

## 1. 产品定位

AgentRoom 是**人类、本地终端和 AI Agent 共同参与的网页聊天室**。核心模型是：

- **AI 不在网页里**。每个 AI（Claude、Codex）运行在各自用户本机的终端和工作区，
  通过本地 Bridge 接入房间。
- **网页是人类的编排控制台**。人类创建房间、把本地 AI 接入、给特定 AI 派发任务、
  查看执行状态与交付结果，再把结果转派给下一个 AI。
- **房间是消息中枢**。人类、多个本地 AI、终端通过统一消息协议交换任务、状态与
  回复；AI 之间的协作流转由人类在网页上编排。

当前 MVP 按现有协议实现（人类/owner 派发任务），**AI 间自动接力**的协议变更
（`shared/contracts/` + 后端）作为下一步单独立项，不在本期范围。

## 2. 技术选型

| 层 | 选择 | 说明 |
| --- | --- | --- |
| 框架 | React 19 + Vite 6 + TypeScript | 集成文档示例即 Vite 风格 |
| 路由 | React Router v7 | 轻量成熟 |
| 样式 | Tailwind CSS v4（Vite 插件） | 自制组件基础 |
| 数据请求 | TanStack Query v5 | HTTP 缓存、重试、失效 |
| 实时/状态 | Zustand + 自研 WS 客户端 | 事件与 UI 状态解耦 |
| 表单 | React Hook Form + Zod | 校验与错误展示 |
| 测试 | Vitest + Testing Library | 与后端同栈 |

依赖、配置、测试、`.env.example` 全部位于 `frontend/` 内。

## 3. 页面与路由

```
/                  → 重定向（未登录 → /login，已登录 → /rooms）
/login             → 登录 / 注册（标签页切换）
/rooms             → 我的聊天室列表 + 创建房间
/rooms/:roomId     → 房间主界面（三栏）
```

房间主界面三栏布局（Slack/Discord 风格）：

```
┌──────────┬────────────────────┬──────────────┐
│ 房间列表  │   主区              │ 成员 + 接入   │
│ (侧栏)   │   接入引导 / 消息流  │ 面板         │
└──────────┴────────────────────┴──────────────┘
```

- 左栏：账号已关联房间列表、创建房间入口、当前用户信息。
- 中栏：主区。无 agent 成员时显示接入引导；有 agent 后显示消息流 + 输入框。
- 右栏：成员列表（编队视图）、接入面板（owner）、任务目标选择。

房间 ID 是公开路由信息，访问受成员身份保护（后端 401/403 处理）。

## 4. 数据流

```
HTTP (TanStack Query)                 WebSocket (Zustand)
┌────────────────────┐                ┌───────────────────────────────┐
│ auth (token 状态)   │                │ RealTimeClient (自研)          │
│ rooms 列表          │                │  票据→连接→心跳→退避重连→补消息  │
│ messages 历史       │                │  事件 → dispatch               │
│ members 列表        │                └──────────────┬────────────────┘
│ connector 信息      │                               │
│ 发送消息 (mutation) │                               ▼
└─────────┬──────────┘                ┌───────────────────────────────┐
          │                           │ messageStore (Zustand)         │
          └─────────────►────────────►│  id 去重、sequence 排序         │
                                     │ memberStore                    │
                                     │ deliveryStore                  │
                                     └───────────────────────────────┘
```

- 令牌：账号令牌 `ars_` 存 `sessionStorage`（恢复登录态），登出/401 清除。
  不写入日志、URL、错误上报或 Git。
- 消息：`messageStore` 以 `message.id` 去重、按 `sequence` 排序。HTTP 历史与
  WS 事件共用同一 store，天然合并去重。
- 发送消息走 HTTP mutation，实时回显由 WS `message.created` 完成；若 mutation
  与 WS 竞争，以 id 去重收敛。

## 5. 实时层

自研 `RealTimeClient` 封装完整生命周期：

1. **连接**：`POST /v1/rooms/{roomId}/realtime-tickets` 换取 60s 过期、单次使用的
   票据 → `WebSocket` 连接（`ws(s)://<api-base>/v1/realtime?ticket=...`）。
2. **会话就绪**：收到 `session.ready` 后，从本地最后 `sequence` 调 HTTP 历史接口
   补缺口；补历史期间继续缓存实时事件。
3. **心跳**：每 25s 发送 `{"type":"ping"}`。
4. **断线重连**：指数退避（1s 起，上限 30s）；每次重连**申请新票据**（旧票据作废）。
5. **事件分发**：
   - `member.joined` → memberStore
   - `message.created` → messageStore
   - `delivery.updated` → deliveryStore
   - `delivery.queued` 只发给目标 AI，普通人类客户端通常收不到，前端可忽略。

## 6. 接入引导（首屏重心）

建房间后主区第一屏是「连接 Agent」引导：

1. 前置说明：Node.js 22+、已登录的 Claude Code 或 Codex CLI。
2. 提示用户先在终端 `cd` 到希望 AI 操作的项目目录。
3. **新会话加入** / **已有会话加入**两个复制按钮，分别复制
   `connector.command` 与 `connector.attachCommand`（来自 `GET /v1/rooms/{roomId}/connector`，
   不在前端拼接）。
4. 邀请码单独显示和复制；CLI 在终端里交互式询问邀请码、provider 和昵称。
5. Claude/Codex 两种 provider 的状态说明；不把邀请码追加进命令参数。
6. 明确标记「开发预览」（`@agentroom/bridge` 尚未发布 npm）。

交互：复制后进入「等待 Agent 加入…」引导态；收到 `member.joined`（agent 类型）
后切到消息流并提示「已接入」。无 agent 成员时主区保持引导；有 agent 后引导缩为
右上角按钮可再次打开。

邀请码：服务器不保存明文，刷新后 `GET /connector` 只能重新获得非秘密命令。
owner 丢失邀请码时按钮显示「生成新邀请码」，调用
`POST /v1/rooms/{roomId}/invite-code/rotate`，并明确提示旧邀请码立即失效。

## 7. 消息流（以任务为轴）

三类消息：

| kind | 展示 |
| --- | --- |
| `text` | Slack 式平铺：作者头像 + 昵称 + 时间 + 正文 |
| `agent.task` | 任务消息：目标 Agent 徽章 + delivery 状态条（queued/received/running/replied/failed），running 有动画，failed 红色 + 错误文本 |
| `agent.reply` | AI 结果：缩进 + 紫色竖线，标识「来自哪个 AI」，可折叠查看 |

- 头像用首字母圆形徽标；human / agent / terminal 三种参与者用不同色系
  （人类青 / Agent 紫 / 终端绿）。
- 任务状态条：一个任务发给多个 agent 时，每个 delivery 独立展示状态。
- 「从结果再派发」：AI 回复上提供「转派给…」操作，预填上下文、选择新目标，
  实现人类编排的接力（当前协议内实现，不触发自动接力）。

## 8. AI 任务派发（Agent 所有权授权）

- 本段原 owner-only 规则已被 contract v0.10.0 取代。前端以
  `GET /v1/rooms/{roomId}/agent-access` 的 `canDispatch` 为准；用户必须拥有目标
  Agent，或得到 Agent 所有者明确授权，房间角色不构成 Agent 权限。
- 入口：输入框旁「派发任务」按钮 + 成员面板中每个 agent 的「派发任务」操作。
- 目标选择器多选 agent 成员（去重后最多 10 个）。
- 稳定幂等键：前端第一次点击时生成（UUID），网络重试复用同一键，成功后清除。
- 首次创建 201；重放 200 返回原任务；键被占用换正文/目标时 409
  `IDEMPOTENCY_KEY_REUSED`，按 code 提示用户。
- 普通 `text` 消息不能带 `targetMemberIds` 或 `idempotencyKey`，不会触发 AI。

## 9. 成员面板（编队视图）

- 成员按类型分组：人类 / Agent（Claude · Codex · other）/ 终端。
- agent 成员带 provider 徽标（Claude/Codex 品牌标识）。
- 成员只表示「已加入」不表示在线（无 presence 心跳接口），前端不显示绿色在线点。
- 当前账号对 `canDispatch: true` 的 agent 显示「派发任务」操作。
- `GET /v1/rooms/{roomId}/members` 拉取 + `member.joined` 实时增量。

## 10. 错误处理

统一 API 客户端：封装 `ApiError(status, code, message, requestId)`；保留
`requestId` 供线上排查。

- `401 AUTH_REQUIRED / INVALID_SESSION`：清账号令牌，跳登录页。
- `401 INVALID_TOKEN`：当前令牌没有该房间成员身份，返回房间列表，**不**清账号令牌。
- `403`：邀请码、owner 权限或 AI 权限不足，展示业务提示。
- `404`：房间或资源不存在，返回列表并刷新。
- `409`：重复加入、幂等键冲突或状态冲突，按 `error.code` 处理。
- `429`：注册/登录尝试过多，暂停提交并稍后重试。
- `503`：数据库或迁移不可用，展示服务暂不可用。

## 11. 历史加载

- 进入房间：`GET /v1/rooms/{roomId}/messages?afterSequence=0&limit=50` 拉最新 50 条，
  以返回最大 `sequence` 为初始水位。
- 上翻加载：滚动到顶部时用 `afterSequence=0` 正向累积更早的消息（最多 4 页
  共 200 条），合并进 store，记录 `hasOlder`；消息量超过时显示「已是最早」。
- 纯现有 API 实现，不加 `beforeSequence` 契约（避免跨边界变更）；后续需要时再议。

## 12. 视觉方向

「现代工具风」（Slack/Discord/Linear 气质的 AI 协作工具）：

- 深色主题为主（默认），支持浅色切换。
- 三栏布局；深色底 `#0f1115` 级。
- 参与者色系：人类青 / Agent 紫 / 终端绿；agent 带 provider 徽标。
- 消息 Slack 式平铺；任务带状态条；AI 回复带紫色竖线缩进。
- CLI 命令、代码块、`connectorCommand` 用等宽字体。
- 复制按钮微交互、发送按钮 loading、空房间引导态。

## 13. 测试

- 单元：`messageStore` 去重/排序、断线补消息逻辑、令牌生命周期、
  幂等键生成与复用、表单校验（Zod schema）。
- 组件：三类消息渲染（text / agent.task / agent.reply）、成员列表分组、
  任务派发交互、邀请面板复制。
- 不投入 e2e（MVP 阶段）。

## 14. 本期不做（按集成文档 §9）

- 文件上传、下载、附件元数据（`attachmentIds` 恒为空，前端渲染时忽略）。
- 邮箱验证、找回/修改密码、OAuth。
- 踢出成员、成员令牌撤销。
- presence 在线状态。
- AI 间自动接力（协议变更单独立项）。

## 15. 目录结构

```
frontend/
├── index.html
├── vite.config.ts
├── .env.example            # VITE_API_BASE_URL
├── package.json
└── src/
    ├── api/                # 客户端、错误、类型、queries、mutations
    ├── realtime/           # RealTimeClient、事件处理、重连
    ├── stores/             # message / member / delivery / token
    ├── pages/              # Login、Rooms、Room
    ├── components/         # MessageList、MessageBubble、MemberPanel、
    │                       # ConnectPanel、TaskComposer、…
    ├── lib/                # utils（时间、复制、幂等键）
    └── test/               # setup、mock 数据
```
