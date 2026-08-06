# Frontend progress

> 记录前端实现进度,供后续迭代参考。最后更新:2026-08-06(合并远程治理功能)。

设计基线:`docs/superpowers/specs/2026-08-05-frontend-design.md`(已确认)。
协议基线:`shared/contracts/http/openapi.yaml` + `shared/contracts/realtime/event.schema.json`。

## 完成 ✅

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 工程脚手架 | ✅ | React 19 + Vite 6 + TS + React Router v7 + Tailwind v4(Vite 插件)+ TanStack Query v5 + Zustand 5 + RHF/Zod + Vitest;`npm run lint/typecheck/build/test` 全绿 |
| API 层 | ✅ | `api/types.ts` 字段逐一对齐 openapi.yaml;`client.ts` 统一 `ApiError(status, code, message, requestId)`;`auth.ts`/`rooms.ts` 覆盖注册/登录/me/登出/房间/成员/connector/消息/票据;`hooks.ts` Query 封装,全局 `401 INVALID_SESSION/AUTH_REQUIRED` 清令牌 |
| 鉴权 | ✅ | 账号令牌 `ars_` 存 `sessionStorage`(zustand persist),启动经 `/auth/me` 校验,`401 INVALID_TOKEN` 只回列表不清令牌 |
| 实时层 | ✅ | `RealTimeClient`:票据 → 连接 → 25s 心跳 → 指数退避重连(每次新票据)→ 事件分发(`session.ready`/`member.joined`/`member.presence`/`message.created`/`delivery.updated`/`member.removed`/`room.updated`/`room.dissolved`);WebSocket 可注入,已有生命周期单测 |
| stores | ✅ | message(按 `id` 去重、`sequence` 排序、watermark 水位)、member(稳定分组派生 `groups`,避免 useSyncExternalStore 无限循环)、delivery、token |
| 页面 | ✅ | `/login`(登录/注册 tab,RHF+Zod)、`/rooms`(我的房间+公开大厅+创建)、`/rooms/:roomId`(消息/成员/接入/房主设置;公开免邀请码加入、私有走邀请码表单) |
| 房间治理 | ✅ | 私有/公开切换、改名、**解散**(即房间删除)、踢人二次确认;被踢或解散后实时退出,公开房间可发现和直接加入 |
| 在线状态 | ✅ | 初次 presence 快照 + 30 秒校准 + `member.presence` 实时更新;成员列表明确显示在线/离线 |
| 消息流 | ✅ | 三类消息渲染:text 平铺 / `agent.task` 任务卡+delivery 状态条 / `agent.reply` 紫色竖线可折叠 + **「转派给…」**(预填回复上下文开派发模式);`message.id` 去重、`sequence` 排序 |
| 历史加载 | ✅ | 进入房间**循环拉页到尾**(正序 API,无 beforeSequence 契约),不再只显示最早 50 条;上限 20 页保护;`session.ready` 补缺口 |
| 任务派发 | ✅ | 仅 owner;`TaskComposer` 多选目标 agent(≤10);幂等键首次点击生成(UUID),网络重试复用,`IDEMPOTENCY_KEY_REUSED` 按 code 提示;**成员面板「派发任务」已接线**(预选目标) |
| 错误反馈 | ✅ | 轻量 toast;加入房间区分 404「房间不存在」/503「服务暂不可用」/429「尝试过于频繁」 |
| 接入引导 | ✅ | `ConnectPanel`:安装命令卡片(macOS/Linux、Windows,URL 取自 `connector.installers`)、新会话/已有会话复制(`connector.command`/`attachCommand`)、邀请码显示+旋转(提示旧码失效)、**复制邀请链接**、「等待 Agent 加入」态 |
| delivery 文案 | ✅ | 对照 checklist:`queued` 等待终端 / `received` 已送达终端 / `running` AI 处理中 / `replied` 已回复 / `failed` 执行失败(`received` ≠「AI 已读」) |
| 视觉(浅色终端调度台) | ✅ | 冷调纸白底 + 语义三色(加深保证对比度);JetBrains Mono 数据排版(消息序号/时间戳/状态/命令);`● ◐ ◉ ✓ ✕` 终端状态符号;克制动效 + `prefers-reduced-motion` 支持 |
| 测试 | ✅ | 覆盖安装命令、幂等键、message/member store、presence、RealTimeClient(连接/治理事件/心跳/断线重连)、DeliveryStatusBadge 文案 |

## 已知占位 / 待办 🔶

- **历史超上限**:初始加载上限 20 页(1000 条);超长房间未拉取部分需后端增加
  `beforeSequence` 契约后再支持(规格 §11 已注明不加该契约的现状)。
- **接入引导空态**:无 agent 时中栏直接渲染 `ConnectPanel`,视觉可再打磨;有 agent 后引导缩为右栏 tab。

## 明确不做(规格 §14,MVP 范围外)

文件上传/附件、邮箱验证、找回/修改密码、OAuth、AI 间自动接力(协议变更单独立项)。

## 运行

```powershell
cd frontend
npm run dev        # http://localhost:4000(需后端 8787 已启动)
npm test           # Vitest
npm run build      # 生产构建
```

- 本地联调:`.env` → `VITE_API_BASE_URL=http://127.0.0.1:8787`(已被 git 忽略)。
- 前端 dev 端口为 4000;后端 CORS 需允许该 origin(本地用环境变量
  `CORS_ORIGIN=http://localhost:4000` 启动;注意当前后端不读取 `.env` 文件,
  需显式传入进程环境变量)。
- 后端内存模式即可演示;重启后数据清空。
