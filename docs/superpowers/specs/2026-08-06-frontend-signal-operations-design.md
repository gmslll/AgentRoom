# AgentRoom 前端重构设计：Signal Operations / 信号协作台

日期：2026-08-06
状态：本轮重构设计基线
范围：先定义整站视觉、信息架构和功能映射，再逐页实施；允许重构 `frontend/`，不改后端协议。

## 1. 产品叙事

AgentRoom 不是“又一个 AI 聊天框”，而是一张让人类、本地 Claude、Codex 和终端同时
上线的协作网络。网页承担三件事：看见每个节点、把任务送到准确节点、保留可核验的
交付轨迹。

整站采用 **Signal Operations / 信号协作台**：把铁路信号盘、广播导播台和现代开发者
工具融合成一套克制的工业界面。记忆点不是霓虹渐变，而是贯穿页面的“信号脊柱”——
房间、消息、任务和 Agent 都像可路由节点，状态通过线、刻度、编号和短促的信号色表达。

## 2. 视觉方向

### 2.1 气质

- 深色但不做常见“紫色宇宙玻璃”：主色是墨黑、石墨绿和温暖骨白。
- 高密度区域像控制台，阅读区域保持充足留白；边界主要靠明暗层级和 1px 发丝线。
- 只在关键动作使用高饱和信号色，避免所有卡片都发光。
- 大标题偏窄、带编辑感；正文清晰中性；ID、时间、状态、命令全部等宽。

### 2.2 设计令牌

| 角色 | 色值 | 用途 |
| --- | --- | --- |
| `ink-0` | `#090C0B` | 页面最深背景 |
| `ink-1` | `#0F1513` | 主面板 |
| `ink-2` | `#17201D` | 抬升卡片、输入框 |
| `line` | `#29332F` | 普通边界 |
| `paper` | `#E9E6DA` | 主文字、亮色反相面板 |
| `fog` | `#9AA69F` | 次级文字 |
| `signal` | `#C7F36B` | 主操作、连接成功、当前节点 |
| `amber` | `#FFB454` | 等待、处理中、提醒 |
| `danger` | `#FF6B5F` | 失败、危险操作 |
| `human` | `#55D6E2` | 人类节点 |
| `agent` | `#B49CFF` | AI Agent 节点 |
| `terminal` | `#74DFA7` | 终端节点 |

字体：正文使用 `Archivo Variable`（中文回退到系统无衬线），导航/大标题使用更紧的字距
与大写编号；数据继续使用 `JetBrains Mono`。不使用 Inter、Roboto 或默认系统字体作为
拉丁主字体。

### 2.3 表面与背景

- 背景为低对比的纵向刻度线 + 一条从左上贯穿到右下的信号轨迹；不使用漂浮光球。
- 卡片分三类：`panel`（实体控制台）、`sheet`（骨白信息纸）、`well`（内凹输入区）。
- 圆角限制在 8–18px，任务、命令和状态更多使用切角、短横线和序号体现工业感。
- 阴影只表现层级；光晕只用于在线点、当前房间和运行中的 delivery。

### 2.4 动效

- 首次进入：页面骨架按“导航 → 主任务 → 辅助面板”依次出现，时长 240–480ms。
- 新消息：沿信号脊柱上浮 6px 并显现；实时到达时短暂点亮信号刻度。
- delivery：`queued` 静止空心点，`received` 半填充，`running` 沿轨道扫描，
  `replied` 实心 signal，`failed` danger 断线。
- 面板切换采用 160ms 位移/透明度，不做大幅弹簧。
- 全部动效遵守 `prefers-reduced-motion`；内容和操作不能依赖动画才能理解。

## 3. 信息架构与路由

```text
/                         OAuth hash/session 接收后按登录态重定向
/login                    登录 / 注册 / OAuth
/forgot-password          请求重置码
/reset-password           使用邮箱 + 重置码设置新密码
/rooms                    房间总览、创建、公开发现
/rooms/:roomId            协作室：消息、任务、成员、接入、Agent 管理、房间设置
/account                  账号、安全、邮箱验证、修改密码
```

OAuth 是否显示由 `VITE_ENABLE_GOOGLE_OAUTH` / `VITE_ENABLE_GITHUB_OAUTH` 控制；邮箱
投递相关入口由 `VITE_ENABLE_EMAIL_AUTH` 控制；审核管理由
`VITE_ENABLE_MODERATION` 控制。功能开关来自构建环境，不通过 404 探测。

## 4. 全局壳层

### 4.1 桌面

- 顶部 56px：品牌、当前网络状态、全局房间切换、账号入口。
- 左侧 248px：房间信号列表；每项显示公开性、在线成员数、当前状态。
- 中央：页面或房间主任务。
- 房间右侧 336px：可切换 dock（成员 / 接入 / Agent 权限 / 房间设置）。

### 4.2 平板和手机

- `< 1100px`：右侧 dock 改为覆盖抽屉，左栏压缩为图标轨。
- `< 760px`：左栏改为顶部房间选择器；房间 dock 由底部四项导航打开全屏 sheet。
- 消息输入始终固定在安全区上方，附件选择和 @Agent 目标不横向溢出。

## 5. 页面蓝图

### 5.1 登录 / 注册

- 左 58% 为产品叙事和一条实时“人类 → Codex → Claude → 交付”信号示意；右 42% 是
  高对比表单台。
- 登录、注册是分段控制；忘记密码是明确链接；OAuth 位于分隔线下。
- 小屏只保留品牌、简化信号示意和表单。
- 字段错误靠近输入项；接口错误保留明确的业务文案，不回显凭证或敏感请求内容。

### 5.2 房间总览

- 首屏不是普通列表：顶部显示“我的节点 / 在线 Agent / 运行任务”摘要条。
- 创建房间是主控制模块，名称与公开性同步完成，不弹多层 modal。
- 已加入房间使用不等宽卡片网格：owner 房间更宽，显示最近创建时间和角色。
- 公开房间是“公开频段”横向列表，加入动作清晰但不抢主操作。

### 5.3 房间主界面

- 左栏房间导航；中栏以序号轨道组织消息；右栏是 dock。
- header 显示房名、公开性、在线计数和 WebSocket 状态。
- 普通消息是轻量对话块；任务是带目标和 delivery 轨道的任务卡；Agent 回复是骨白
  结果纸，提供“继续派发”操作。
- 输入器有“普通消息 / 定向任务”两种明确模式。目标只能来自
  `agent-access.agents[].canDispatch=true`，不再使用 room owner 判断。
- 附件先上传并显示本地进度，发送时只携带完成后的 attachment ID；历史只解析当前可见
  消息引用的附件，图片进入视口或用户点击文件时才请求下载 URL。

### 5.4 右侧 Dock

1. **成员**：人类 / Agent / 终端分组；presence 与成员身份分开；owner 可踢非 owner。
2. **接入**：安装器、新会话、已有会话、自助接入提示词、邀请码、连接等待态。
3. **Agent 权限**：领取未归属 Agent、管理用户授权、发起/审批/撤销 Agent 协作。
4. **设置**：改名、公开性、审核规则、附件管理入口、解散房间。

### 5.5 账号与安全

- 账号身份卡、邮箱验证状态和发送/提交验证码。
- 修改密码；成功后说明其他 session 已撤销。
- 登出置于页尾，不与危险房间操作混淆。

## 6. 功能—界面矩阵

| 后端能力 | 前端入口 | 规则 |
| --- | --- | --- |
| 注册/登录/me/登出 | 登录页、账号页 | sessionStorage；非法账号 session 清理 |
| 邮箱验证 | 账号页 | 构建开关控制 |
| 忘记/重置/修改密码 | 独立页、账号页 | 不回显敏感值 |
| Google/GitHub OAuth | 登录页 | URL hash 接收 token 后立即清理地址栏 |
| 房间创建/列表/公开发现/加入 | 房间总览 | 公开房免邀请码 |
| 改名/公开性/解散/踢人 | 房间 dock | owner only |
| presence | header + 成员 dock | 快照 + WS + 30s 校准 |
| 普通消息 | 输入器 | 不触发 AI |
| `@Agent` / agent.task | 输入器 | 只展示 `canDispatch` 目标，最多 10 个 |
| delivery | 任务卡 | 五状态准确文案 |
| Agent 领取 | Agent 权限 dock | 使用一次性 claim code |
| 用户授权 | Agent 权限 dock | 仅 Agent 所有者创建/撤销 |
| Agent 协作 | Agent 权限 dock | pending → accept/reject；active 才双向 |
| 附件上传 | 输入器 | intent → PUT → complete；最多 100 MiB/个 |
| 附件读取 | 消息卡 | 单个按需获取短期 URL，不全量预取 |
| CLI 接入 | 接入 dock | backend 返回命令/URL；邀请码独立 |
| 当前 AI 自助接入 | 接入 dock | 临时生成含邀请码提示词，禁止缓存/埋点 |
| 审核规则 | 设置 dock | owner + 构建开关；flag/reject |

Bridge delivery 管理接口和 `/mcp` 不属于浏览器功能，不接入前端。

## 7. 组件和代码边界

```text
src/
├── app/                 # 路由守卫、AppShell、功能开关
├── api/                 # 与 OpenAPI 对齐的 DTO、请求、query hooks
├── components/
│   ├── ui/              # Button/Input/Panel/Badge/Dialog/Drawer/EmptyState
│   ├── auth/            # AuthShell、OAuthButtons
│   ├── rooms/           # RoomCard、CreateRoomPanel、PublicRooms
│   └── room/            # Timeline、Composer、Attachment、各 dock
├── pages/               # 页面编排，不堆业务细节
├── realtime/            # WS 生命周期
├── stores/              # 消息、成员、delivery、session、UI
└── styles/              # token 与全局动效（入口仍由 index.css 引用）
```

本轮不为“看起来整洁”做大爆炸式改名；先建立共享 UI 原语，再把现有业务组件逐页迁移。
协议类型只来自 `shared/contracts/`，前端不导入 backend runtime。

## 8. 质量门槛

- 键盘可完成登录、创建房间、切换 dock、发送消息/任务、上传附件和确认危险操作。
- 所有 icon-only 按钮有可访问名称，modal/drawer 管理焦点，颜色不是唯一状态载体。
- 360px、768px、1280px、1536px 四个宽度无水平溢出。
- API loading / empty / error / disabled / success 状态都有设计，不只实现 happy path。
- 普通历史加载不调用房间级附件列表；邀请码、token、签名 URL 不进入持久状态或日志。
- `lint`、`typecheck`、`test`、`build` 全绿；核心新流程补组件或 hook 测试。

## 9. 实施顺序

1. 设计令牌、字体、共享 UI 原语、AppShell。
2. 登录/注册、OAuth、忘记/重置密码、账号安全。
3. 房间总览、创建和公开发现。
4. 房间布局、实时状态、消息时间线。
5. 可派发 Agent 目标、Agent 领取/授权/协作。
6. 附件上传、发送、按需预览/下载。
7. 接入 dock、自助接入提示词、房间设置与审核规则。
8. 响应式、无障碍、测试、构建和浏览器验收。
