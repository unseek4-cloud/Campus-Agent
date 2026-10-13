# 对话分享：图片导出、多选分享与公开分享链接

> 前端已于 2026-10-13 合并为唯一 Vue 版本。本文中的旧静态入口与旧 Vue 组件路径为历史记录；当前启动、源码和测试命令见 [前端说明](../frontend/README.md) 与 [迁移记录](ui-vue-migration.md)。

学生可在问答页把整段会话或选中的几条消息分享出去：复制/导出 PNG 长图，或生成一条**免登录只读**的公开链接（后端 token，可撤销、默认 30 天有效）。

## 1. 界面行为

- **每条消息一条操作条**：气泡下方有 `⎘ 分享`、`▤ 复制` 与消息时间（今天/昨天/日期 + 时刻），鼠标悬停显示，触屏常驻。
- **点分享进入多选**：所有消息变为可点选（虚线提示），被选中的消息加主色描边、按钮文案变 `✓ 已选`；问答区上方出现工具条：`已选 N / 总数`、全选、清空、复制为图片、导出图片、生成分享链接、取消。
- **头部「⎘ 分享对话」**：整段会话的快捷入口（复制为图片 / 导出 PNG / 生成分享链接 / 选择消息分享），并给出实时图片预览。
- **生成链接后**弹窗展示可复制的链接、打开预览、撤销这条链接，并说明“无需登录、只读、30 天有效”。
- 图片是 Canvas 2D 手绘的 720×2 高清长图（跟随当前主题色、含品牌页头、消息气泡、引用列表与免责页脚），不依赖任何第三方库或 CDN。
- 端点：`POST /api/chat/conversations/{id}/shares`（带 `messageIds` 即只分享选中消息）、`GET`/`DELETE` 同路径列表与撤销、`GET /api/share/chat/{token}` 公开只读。

## 2. 公开分享页 `#/share/<token>`

- 访客**不需要登录**：前端启动时先判断 hash，命中分享链接就直接渲染只读页，不调用 `/api/auth/me`，也不显示登录页与应用外壳（`body[data-auth="share"]`）。
- 页面内容：品牌页头、会话标题、分享时间/浏览次数/有效期、双方消息（复用 `renderChatTurn`，因此引用与事项卡照旧）、页脚免责说明；同样支持复制为图片与导出图片。
- 链接失效（不存在、已撤销、已过期）时给出可读提示，而不是空白页。

## 3. 后端设计

新增迁移 `db/migration/V8__conversation_share.sql`（已注册到 `spring.sql.init.schema-locations`）：

| 列 | 说明 |
| --- | --- |
| `token CHAR(43)` | 主键，32 字节 `SecureRandom` 的 URL-safe base64，是公开读取的唯一凭证 |
| `conversation_id` / `user_id` | 外键，`ON DELETE CASCADE`（删除会话即失效） |
| `title` | 分享时的会话标题快照 |
| `revoked` / `expires_at` | 撤销标记与过期时间（默认 30 天，最长 365 天） |
| `message_ids TEXT` | JSON 数组；为空表示整段会话，非空表示只分享选中的消息 |
| `view_count` / `last_viewed_at` | 只读访问计数，用于分享页展示“浏览 N 次” |

- `ChatShareService`：拥有者用登录态创建/复用链接（**相同会话 + 相同消息选择**复用同一个 token，避免重复点击产生一堆链接）、列出、撤销；`view(token)` 校验 token 存在、未撤销、未过期，并且**只回只读 DTO**（`SharedConversation` / `SharedMessage`：`role`、`content`、`response`、`createdAt`，不含 `requestId` 与账号字段）。
- `ChatShareController`（`/api/share/chat/{token}`）只提供 GET；`SecurityConfiguration` 只放行 `GET /api/share/**`，其余 `/api/**` 仍需登录。
- 分享选中消息时会校验 `messageIds` 属于该会话，否则返回 `400 SHARE_MESSAGE_NOT_FOUND`。

## 4. 自动测试

后端（`mvn -o -B test`，H2 + MockMvc）：

- `campus-app`：`ChatShareIntegrationTest` 6 项 —— 拥有者创建后访客免登录读取、重复分享复用 token、浏览计数、撤销/过期/未知 token 全部 404、越权（其它账号与管理员、未登录、跨会话撤销）被拒、公开路由只允许 GET、公开 payload 不含 `requestId`/`password`/用户名、只分享选中消息（含相同选择复用、不同选择各自有效、跨会话消息 id 被拒、逐个撤销互不影响）、删除会话级联清理且迁移可重复执行。
- 全量后端套件 114 项通过（含既有 `ChatHistoryIntegrationTest` 6 项，确认分享改动未影响历史功能）。

前端（`.dsh-tmp/*.mjs`，假 DOM + 记录型 Canvas 执行真实源码）：

- `msg-share-ui-test.mjs` 39 项 —— 操作条与时间、重复增强不叠加、进入多选与选中态、工具条计数与全选/清空、点击链接不误选、选中转录带后端消息 id、按 `messageIds` 请求分享、弹窗链接/说明/撤销、退出多选清理、公开分享页渲染与按钮接线、分享页导出图片、失效链接提示、退出后回到应用或登录页。
- `share-test.mjs` 30 项（转录、长图排版、链接走后端、复制/导出路径）、`deeplink-test.mjs` 9 项（`#/qa?conversation=` 站内深链）、`static-check.mjs`（含分享接线、样式与后端文件的存在性断言）。

## 5. 边界

- 公开链接**只覆盖被分享的那一段会话**，不含账号信息；但拿到链接的人都能只读查看，撤销前请自行确认内容。
- 图片里的消息来自当前页面 DOM：事项引导卡的正文会进图片，卡片结构（步骤/材料清单布局）不会。
- 欢迎语等没有后端记录的消息无法进入“选中消息”链接，弹窗会提示有 N 条未包含。
- 分享页是只读的：不能继续提问、不能引用追问，也不显示调试计数。
