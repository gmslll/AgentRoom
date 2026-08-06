# Frontend progress

> 记录前端实现进度,供后续迭代参考。最后更新:2026-08-06。

设计基线:`docs/superpowers/specs/2026-08-05-frontend-design.md`(已确认)。
协议基线:`shared/contracts/http/openapi.yaml` + `shared/contracts/realtime/event.schema.json`(v0.8.0)。

## 完成 ✅

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 工程脚手架 | ✅ | React 19 + Vite 6 + TS + React Router v7 + Tailwind v4(Vite 插件)+ TanStack Query v5 + Zustand 5 + RHF/Zod + Vitest;dev 端口 3000;`npm run lint/typecheck/build/test` 全绿 |
| API 层 | ✅ | `api/types.ts` 字段逐一对齐 openapi.yaml;`client.ts` 统一 `ApiError(status, code, message, requestId)`;`auth.ts`/`rooms.ts` 覆盖注册/登录/me/登出/房间/成员/connector/消息/票据;`hooks.ts` Query 封装,全局 `401 INVALID_SESSION/AUTH_REQUIRED` 清令牌 |
| 鉴权 | ✅ | 账号令牌 `ars_` 存 `sessionStorage`(zustand persist),启动经 `/auth/me` 校验,`401 INVALID_TOKEN` 只回列表不清令牌 |
| 实时层 | ✅ | `RealTimeClient`:票据 → 连接 → 25s 心跳 → 指数退避重连(每次新票据)→ 事件分发(`session.ready`/`member.joined`/`message.created`/`delivery.updated`/`member.removed`);WebSocket 可注入,已有生命周期单测 |
| stores | ✅ | message(按 `id` 去重、`sequence` 排序、watermark 水位)、member(稳定分组派生 `groups`,避免 useSyncExternalStore 无限循环)、delivery、token |
| 页面 | ✅ | `/login`(登录/注册 tab,RHF+Zod)、`/rooms`(列表+创建+登出)、`/rooms/:roomId`(三栏:房间列表/消息流+composer/成员+接入面板;邀请码加入表单) |
| 消息流 | ✅ | 三类消息渲染:text 平铺 / `agent.task` 任务卡+delivery 状态条(queued→running 动画→replied/failed)/ `agent.reply` 紫色竖线可折叠;`message.id` 去重、`sequence` 排序 |
| 任务派发 | ✅ | 仅 owner;`TaskComposer` 多选目标 agent(≤10);幂等键首次点击生成(UUID),网络重试复用,`IDEMPOTENCY_KEY_REUSED` 按 code 提示 |
| 接入引导 | ✅ | `ConnectPanel`:安装器链接(macOS/Linux/Windows 直连 `connector.installers`,不前端拼装)、新会话/已有会话复制(`connector.command`/`attachCommand`)、邀请码显示+旋转(提示旧码失效)、「等待 Agent 加入」态(复制命令后置起,收到 agent `member.joined` 清除) |
| 测试 | ✅ | 14 个单测:幂等键、messageStore 去重/排序/水位、memberStore 分组+引用稳定性、RealTimeClient 连接/事件分发/心跳/断线重连 |

## 已知占位 / 待办 🔶

- **上翻加载更早消息**:`MessageList` 的 `onLoadOlder` 目前空操作;规格要求 `afterSequence=0` 正向累积(最多 4 页 200 条),尚未实现。
- **「转派给…」接力**:`agent.reply` 上「从结果再派发」交互未实现(规格 §7)。
- **MemberPanel「派发任务」回调**:`onDispatchTask` prop 已定义但 `RoomPage` 未接线(目前统一走 `TaskComposer`)。
- **presence 事件**:handler 已接(`member.presence`),UI 未使用(MVP 不显示在线点,符合规格)。
- **接入引导空态**:无 agent 时中栏直接渲染 `ConnectPanel`,视觉可再打磨;有 agent 后引导缩为右栏 tab(规格 §6 建议右上角按钮,当前实现为右栏切换)。

## 明确不做(规格 §14,MVP 范围外)

文件上传/附件、邮箱验证、找回/修改密码、OAuth、踢人、presence 在线点、AI 间自动接力(协议变更单独立项)。

## 运行

```powershell
cd frontend
npm run dev        # http://localhost:3000(需后端 8787 已启动)
npm test           # Vitest
npm run build      # 生产构建
```

- 本地联调:`.env` → `VITE_API_BASE_URL=http://127.0.0.1:8787`(已被 git 忽略)。
- 后端内存模式即可演示;重启后数据清空。
