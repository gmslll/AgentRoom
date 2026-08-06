# AgentRoom 前端 UI 升级:深空指挥舱

日期:2026-08-06
状态:已批准(用户选择「深空指挥舱」方向)

## 1. 目标

在不改动任何功能逻辑、状态、hooks、数据流的前提下,对前端全部页面与组件做
视觉与交互动画升级,风格为「深空指挥舱」:深色科技纵深 + 玻璃拟态 + 语义色发光
+ 克制而丰富的动效。零新依赖,纯 CSS(Tailwind v4 `@theme` + `@keyframes`)与
className 调整。

## 2. 视觉基调

- **深空背景**:`#0a0c12 → #0f1115` 径向渐变,叠加极淡网格线(1px、6% 白),
  构建指挥舱纵深。背景通过 `body::before/::after` 实现,`pointer-events-none`,
  不影响交互。
- **环境光**:青 `#22d3ee` / 紫 `#a78bfa` / 绿 `#34d399` 三颗低透明度光斑
  (6–8%、blur 120px)在背景缓慢漂移(`background-position` 动画,周期约 60s)。
- **玻璃拟态**:`.glass` 工具类 = 半透明背景(rgba 白 3–6%)+ `backdrop-blur`
  + 1px 细边框(rgba 白 6–10%)。用于侧栏、卡片、输入区;消息流本体不用 blur
  (性能),用普通半透明底。

## 3. 语义色发光(产品特有)

保留并强化 人类青 / Agent 紫 / 终端绿 三色语义:

- 头像、provider 徽章、在线点带同色 `box-shadow` glow。
- 任务 delivery 状态:`running` 流光(背景渐变位移动画),`replied` 绿色呼吸,
  `failed` 红色警示。
- 在线点:扩散脉冲动画。

## 4. 交互动效

| 位置 | 效果 |
| --- | --- |
| 消息 | 逐条淡入上浮(200ms,`animation-delay` 交错) |
| 卡片/按钮 | hover 上浮 + 边框发光 + 光晕;active 微缩 |
| 发送按钮 | 点击脉冲;发送中 loading 态 |
| 复制 | 成功绿色闪烁 |
| 输入框 | focus 发光边框 |
| 房间列表 | 卡片交错渐入(`nth-child` stagger)+ hover 上浮 |
| 登录页 | 玻璃卡片 + 渐变标题文字 + tab 切换微动效 |

**无障碍底线**:所有动画在 `prefers-reduced-motion: reduce` 下关闭;键盘
focus 可见(`focus-visible` 样式);滚动条美化(webkit,暗色细条)。

## 5. 页面与组件清单

- `index.css`:`@theme` 扩展 token、`@keyframes`、`.glass`/`.text-gradient`/
  `.glow-*` 工具类、背景伪元素、滚动条、reduced-motion。
- `LoginPage` / `RoomsPage` / `RoomPage`:布局样式与入场动效。
- 组件:`Avatar`(glow)、`CopyButton`(复制反馈)、`DeliveryStatusBadge`(流光/
  呼吸)、`MessageBubble`(入场 + 回复紫色光)、`MessageList`、`MemberPanel`
  (在线点脉冲)、`ConnectPanel`、`TaskComposer`(focus 发光 + 发送脉冲)。

## 6. 不做

- 不改功能逻辑/状态/hooks/API 层。
- 不加依赖、不引入新字体(沿用系统字体栈 + 等宽 mono)。
- 不做响应式重排(现有布局保持)。
