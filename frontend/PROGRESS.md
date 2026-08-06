# Frontend progress

> 最后更新：2026-08-07（release-v0.7.0）。当前实现以
> [`../docs/superpowers/specs/2026-08-06-frontend-signal-operations-design.md`](../docs/superpowers/specs/2026-08-06-frontend-signal-operations-design.md)
> 为视觉与交互基线，以 `shared/contracts/` 为协议基线。

## 已完成

| 模块 | 状态 | 当前实现 |
| --- | --- | --- |
| 视觉系统 | ✅ | Signal Operations 深色工业协作台；Archivo Variable + JetBrains Mono；signal/human/agent/terminal 语义色；切角、信号轨、骨白交付纸；reduced-motion |
| 响应式壳层 | ✅ | 桌面房间导航 + 消息工作区 + 控制 dock；平板/手机使用左右抽屉和底部房间工具栏 |
| 账号 | ✅ | 登录、注册、会话恢复、登出、邮箱验证、忘记/重置/修改密码、Google/GitHub OAuth hash 接收；邮件和 OAuth 入口由构建开关控制 |
| 房间总览 | ✅ | 创建私有/公开房间、我的房间、公开发现与直接加入；创建响应的一次性邀请码带入接入面板后立即从浏览器历史清除 |
| 房间治理 | ✅ | 改名、公开性、解散、踢人、审核规则；owner-only 操作只进入设置/成员 dock |
| 消息与实时 | ✅ | 三类消息、历史去重、WebSocket 票据/心跳/重连、header 连接状态、presence 快照与实时事件、被踢/解散自动退出 |
| Agent 派发 | ✅ | 普通消息与定向任务模式分离；结构化 `@Agent` 选择只展示 `agent-access.canDispatch=true`；多目标、幂等键、delivery 五状态、继续派发 |
| Agent 权限 | ✅ | 一次性 claim code 领取、用户授权/撤销、跨所有者 Agent 协作申请/接受/拒绝/撤销；不再把 room owner 当作 Agent 所有者 |
| 文件附件 | ✅ | intent → PUT → complete；普通消息和 Agent task 可带附件；历史只保留 ID，进入视口才按 ID 获取短期下载 URL；房间级台账需 owner 主动打开 |
| 本地接入 | ✅ | macOS/Linux、PowerShell、CMD 安装；新会话与已有会话；邀请码旋转；公开房；已有 AI 一句话自检安装并 `attach --session last --no-launch` |
| 质量门 | ✅ | `lint`、`typecheck`、`test`、`build` 通过；23 个测试覆盖权限过滤、附件懒加载、自助接入、实时连接、store、delivery 与安装命令 |

## 构建开关

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8787
VITE_ENABLE_EMAIL_AUTH=false
VITE_ENABLE_GOOGLE_OAUTH=false
VITE_ENABLE_GITHUB_OAUTH=false
VITE_ENABLE_MODERATION=false
```

生产服务器当前确认 `FILES_ENABLED=true`；邮件投递、OAuth 和审核没有生产配置，因此
release 构建暂不显示对应入口。代码已经完整接线，配置就绪后在构建环境启用，不通过
404 猜测能力。

## 已知边界

- 历史接口只有 `afterSequence`。前端从 0 正序遍历，最多加载 20 × 50 条；要正确处理
  超过 1000 条的超长房间，需要后端补 `beforeSequence` 或尾页游标协议。
- 当前执行环境没有可连接的浏览器实例，本轮已完成代码、响应式规则、构建和 jsdom
  交互验证，但 360/768/1280/1536 的截图级浏览器验收仍需在浏览器可用时补做。
- Bridge 专用 pending/status/reply 和 `/mcp` 不属于网页能力；网页只展示后端产生的
  task、reply 和 delivery 事件。

## 本地运行

```bash
cd backend
CORS_ORIGIN=http://127.0.0.1:4000 npm run dev

cd ../frontend
cp .env.example .env
npm run dev                 # http://127.0.0.1:4000
npm run lint
npm run typecheck
npm test
npm run build
```
