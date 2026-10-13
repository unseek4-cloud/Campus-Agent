# 对话图片与公开分享

当前问答页支持选中消息复制为图片、导出 PNG 长图和公开只读链接。公开地址为 `/#/share/<token>`，访客无需登录。消息正文可能包含个人信息，分享范围由用户选择。

## 页面与图片

AI 回复操作栏中的分享进入消息多选；会话头部也提供整体分享。工具条显示已选数、全选/清空、复制为图片、导出、生成链接和取消。图片由 Canvas 2D 手绘，跟随主题，逻辑宽度 720、缩放倍率 2，无第三方截图依赖。

导出数据取实际选中的消息列表，公开页使用分享 API 返回的列表。事项卡片正文可进入图片，不保证完整复制卡片交互布局。复制图片需要浏览器 Clipboard API 和允许的上下文/权限；不支持时可导出文件。极长对话受 Canvas 和浏览器资源上限影响，没有保证任意长度。

公开页复用回答 Markdown 与只读卡片，隐藏个人清单、模板下载、申请、反馈操作和检索调试，不访问 /api/auth/me。匿名不具备知识原文件接口权限，也没有访问所有会话的入口。

## 创建时固定范围

V8 的 ai_conversation_share 保存 43 字符随机 token、会话/用户关联、标题快照、message_ids、撤销、过期、访问数和时间。token 由 32 个 SecureRandom 字节 URL-safe Base64 生成，是公开读取凭证。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| POST | /api/chat/conversations/{id}/shares | 本人创建，JSON 可选 ttlDays/messageIds |
| GET | /api/chat/conversations/{id}/shares | 本人查询分享记录 |
| DELETE | /api/chat/conversations/{id}/shares/{token} | 本人撤销，写操作需 CSRF |
| GET | /api/share/chat/{token} | 匿名只读，有效 token 才返回 |

选中 ID 必须属于会话，错误为 400 SHARE_MESSAGE_NOT_FOUND。空 messageIds 表示展开为创建时已有全部 ID，空会话拒绝 SHARE_EMPTY；继续聊天不会进入旧分享。旧无 ID 快照链接只读创建时间严格之前的消息，同毫秒边界保守排除。

默认有效 30 天，最长 365；非正 ttlDays 用默认值。同一会话中只有当前最新有效分享的 ID 集合相同时复用 token，不保证任意历史相同选择都去重复用，也不因复用重新计算期限。

公开 DTO 返回标题、时间、访问数、消息 ID 范围，以及 role/content/response/createdAt，不含 requestId、账号、评价或管理员备注。正文中的用户自行输入的身份信息不会自动脱敏；拿到 token 的人都能读选中内容。不存在/撤销/过期统一 404 SHARE_NOT_FOUND，删除会话级联失效。

## 验收

登录后选两条消息生成链接，隐私窗口确认仅选中内容；继续聊天后旧链接不扩大；不同选择生成不同范围；撤销和删除会话后链接失效；检查图片也仅导出所选消息。来源摘要可阅读，私有文件和可写操作不开放。

启动见 [统一说明](service-application-startup.md)，测试为 ChatShareIntegrationTest、ReplyFeedbackIntegrationTest、workspace.chat-workspace.e2e.mjs。运行 frontend 的 npm run test:browser 和 backend 的 mvn test；目前没有旧 .dsh-tmp 或静态版测试脚本。当前结果见 [文档索引](README.md#本次检查与验证)。

没有自动个人信息遮盖、分享密码或不可变全文副本；消息来自数据库，范围固定不等于复制了独立的全量政策版本。
