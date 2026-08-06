# 前端变更清单

这份清单用于前后端交接；完整请求示例和字段语义见
[`frontend-backend-integration.md`](./frontend-backend-integration.md)，协议仍以
[`../shared/contracts/http/openapi.yaml`](../shared/contracts/http/openapi.yaml) 和
[`../shared/contracts/realtime/event.schema.json`](../shared/contracts/realtime/event.schema.json)
为准。

线上 API 基址固定为 `https://try-status.online/api`，根域名 `/` 留给前端。
推送 `release-vX.Y.Z` 标签时，同一个 GitHub Actions release 会用该 API 基址构建
前端，并把 `frontend/dist` 与同提交的后端一起原子部署到服务器；前端不需要单独发布。

## 现在需要调整

- delivery 文案使用：`queued`“等待终端”、`received`“已送达终端”、`running`
  “AI 处理中”、`replied`“已回复”、`failed`“执行失败”。`received` 不等于“AI 已读”。
- 进入房间时请求 `GET /v1/rooms/{roomId}/presence`，并实时处理
  `member.presence`；不要根据成员列表猜在线状态。
- 处理 `member.removed`。当前成员被移除时关闭 WebSocket、清理房间状态并返回房间
  列表；其他成员被移除时更新成员和 presence 列表。
- owner 成员管理页接入
  `DELETE /v1/rooms/{roomId}/members/{memberId}`，不要提供移除 owner 的操作。
- 保持对 `message.created` 和 `delivery.updated` 的 ID 去重；agent 的显式 relay 会表现
  为新的任务消息和 delivery，前端不要解析回复正文来自动触发 AI。

## session-card 对前端的影响

session-card 是目标电脑 `.agentroom/` 下的本地可靠性证据。它没有新增公开 API 字段，
前端不读取、不展示、不上传该文件或本地路径。前端唯一变化是准确展示上述 delivery
状态语义。

## 可以继续接入

- 附件：upload intent -> 对象存储 PUT -> complete -> 普通文字消息携带
  `attachmentIds`。下载前重新获取短期签名 URL，不持久化该 URL。
- 账号：邮箱验证、忘记密码、修改密码，以及按部署开关显示 Google/GitHub OAuth。
- owner 审核规则：`flag` 结果可在消息上显示，`reject` 发送失败按业务错误展示。
- AgentRoom CLI 面板继续直接使用接口返回的 `connector.command`、
  `connector.attachCommand` 和 `connector.installers`，不要手拼下载 URL 或命令。

文件、OAuth、邮件和审核都是后端已实现但依赖生产配置的能力。对应配置未由后端确认
前，前端用产品功能开关隐藏入口；不要通过“路由是否返回 404”做能力探测。

## 不需要改

- 不调用 Bridge 专用的 delivery pending/status/reply 接口。
- 不从浏览器连接 `/mcp`。
- 不改变账号令牌与成员 ID 的既有模型。
- 不把邀请码、账号令牌、成员令牌、签名 URL 或本地路径写入日志和错误上报。
