# Frontend progress

> 记录前端实现进度。最后更新:2026-08-07(协作者完成 Signal 重构后同步)。

设计基线:`docs/superpowers/specs/2026-08-05-frontend-design.md`。
协议基线:`shared/contracts/http/openapi.yaml` + `shared/contracts/realtime/event.schema.json`。

## 现状(2026-08-07)

协作者已完成 **Signal Operations 重构**(`2d86112`):前端重建为信号控制台风格,
新增 AppShell/AuthShell/BrandMark/Icon/PageState 等 UI 基座、账号页、忘记/重置
密码页、Agent 授权协作、附件按需加载、self-onboarding。经全量审计(与
`docs/frontend-change-checklist.md` 逐项核对),以下能力**全部已对接**:

| 能力 | 入口 |
| --- | --- |
| 邮箱验证 | `AccountPage` EmailVerification(`features.emailAuth` 开关) |
| 忘记/重置密码 | `ForgotPasswordPage` / `ResetPasswordPage` |
| 修改密码 | `AccountPage` PasswordPanel |
| OAuth(Google/GitHub) | `LoginPage` OAuthButton + `App` OAuthSessionCapture(fragment 回调) |
| 审核规则 | `RoomSettingsPanel` ModerationManager;消息 moderation 状态在 MessageBubble 展示 |
| 附件 | TaskComposer AttachmentPicker(上传≤10);RoomSettingsPanel 附件台账(懒加载);AttachmentStrip 进视口按需下载(IntersectionObserver);agent.task 携带 attachmentIds |
| Agent 领取/授权/协作 | `AgentAccessPanel`(RoomPage「授权」tab):claim code、grant/revoke、collaboration 申请/接受/拒绝/撤销 |
| @Agent 派发选择器 | TaskComposer 目标多选 + MemberPanel 每行派发,均按 `useAgentAccess` canDispatch 过滤;全员可派发 |
| self-onboarding | ConnectPanel「让当前 AI 自己接入」(`lib/self-onboarding.ts`),私有房间需先生成邀请码 |
| 功能开关 | `config/features.ts` 读 `VITE_ENABLE_*`;emailAuth/googleOAuth/githubOAuth/moderation 均在实际 UI 生效 |
| 路由 | `/` `/login` `/forgot-password` `/reset-password` `/account` `/rooms` `/rooms/:roomId` |

## 本轮已处理(2026-08-07)

- 安装缺失依赖 `@fontsource-variable/archivo`(typecheck 失败修复)。
- `PasswordPanel` 对齐开关:仅 `features.emailAuth` 时显示(修复不一致)。
- 注册成功后如开启 emailAuth,toast 引导去「账号设置」完成邮箱验证。
- `.env.example` 补功能开关说明(每个开关需对应后端能力,否则 UI 入口会运行时报错)。
- 滚动条细化 + 全员可派发任务(此前轮次)。

## 已知占位 / 待办 🔶

- **历史超上限**:初始加载上限 20 页(1000 条);超长房间需后端增加
  `beforeSequence` 契约后再支持(规格 §11 已注明)。
- **功能开关默认全关**:本地 `.env` 未设 `VITE_ENABLE_*`,邮箱验证/忘记密码/
  OAuth/审核 UI 默认隐藏。需按部署目标启用(注意后端能力匹配)。
- **后端邮箱验证 500**(后端侧):`POST /v1/auth/email/verification` 在本地
  dev server 返回 500(tsx 直连 app 正常,疑与 dev server 运行环境有关);
  前端调用已就绪,待后端排查。

## 明确不做(规格 §14,MVP 范围外)

文件上传之外的附加能力按契约演进;AI 间自动接力走 relay 契约。

## 运行

```powershell
cd frontend
npm run dev        # http://localhost:4000(需后端 8787 已启动)
npm test           # Vitest(25 测试)
npm run build      # 生产构建
```

- 本地联调:`.env` → `VITE_API_BASE_URL=http://127.0.0.1:8787`(已被 git 忽略)。
- 后端 CORS:用 `CORS_ORIGIN=http://localhost:4000` 显式传环境变量启动
  (后端当前不读取 `.env` 文件)。
- 后端内存模式即可演示;重启后数据清空。
