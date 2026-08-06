# Frontend

AgentRoom 的 React 19 + Vite 网页协作台。它让已登录的人类管理房间、查看实时成员、
发送普通消息、向被授权的本地 Claude/Codex 派发任务，并管理 Agent 权限与附件。

## 开发约定

- HTTP 和 WebSocket 协议只来自 `../shared/contracts/`，禁止导入 `backend/src/`。
- 视觉与交互基线见
  `../docs/superpowers/specs/2026-08-06-frontend-signal-operations-design.md`。
- 当前实现进度、构建开关和已知边界见 `PROGRESS.md`。
- 生产 API 基址为 `https://try-status.online/api`；根域名留给本页面。

## 运行

```bash
cp .env.example .env
npm ci
npm run dev
```

开发地址为 `http://127.0.0.1:4000`。后端需以匹配的
`CORS_ORIGIN=http://127.0.0.1:4000` 启动。

提交前运行：

```bash
npm run lint
npm run typecheck
npm test
npm run build
```
