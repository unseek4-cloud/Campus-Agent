# AI 聊天历史与重新生成

会话和消息按登录用户持久化到 MySQL，Python 只接收 Java 转发的临时上下文。当前 Vue 页面 /#/qa 支持恢复、切换、新建、删除和重新生成，旧浏览器未保存的消息无法补回。

## 数据与发送时序

V7 创建 ai_conversation 和 ai_message，随 SQL Init 启动执行。会话保存归属、标题、更新时间、pending_request_id/pending_since；消息保存角色、正文、request_id、sources_json 和时间。消息按 created_at/id 顺序，列表按 updated_at/id 倒序，当前无历史列表分页。

标题取第一条问题前 30 个 Unicode 字符，不调用模型。消息唯一键 (conversation_id,request_id,role)，每次成功发送对应 USER 和 ASSISTANT 各一条，AI 失败只保留 USER。

```text
短事务：检查归属/行锁/请求去重 → 保存 USER → 设置生成租约 → 提交
事务外：事项识别 → 数据库指南或 Python RAG
短事务：检查租约仍有效 → 保存 ASSISTANT 与快照 → 释放租约
```

租约 5 分钟后视为过期，以释放异常中断请求。生成中另一个请求返回 409。相同会话/UUID 已成功则返回已保存结果，不重调模型；UUID 不能复用于不同问题。失败请求只有没有后续新消息时才可原 ID 重试。省略会话 ID 会自动新建，不能据此保证无会话 ID 的重复调用去重。

删除会话不会在晚到回答时重建；外键级联清理消息、分享和评价。API 从认证身份取 userId，读/发/删都检查归属，ADMIN 无跨用户特例。不属于本人和不存在均为 404 CHAT_NOT_FOUND。

## 请求与历史来源

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET / POST | /api/chat/conversations | 本人列表/创建空会话 |
| GET | /api/chat/conversations/{id}/messages | messages 和 pending |
| DELETE | /api/chat/conversations/{id} | 删除本人会话 |
| POST | /api/rag/chat | query、可选 knowledgeBaseId/conversationId/requestId |
| POST | /api/chat/messages/{id}/regenerate | requestId，追加新一轮 |

公共问答返回 data 中的 conversationId、userMessageId、assistantMessageId，加上 type/answer/sources/检索计数等原字段。浏览器先创建会话，再提交实际 ID 和新 UUID：

```json
{
  "query": "对象是谁？",
  "knowledgeBaseId": "campus-default",
  "conversationId": 12,
  "requestId": "5a4d68f0-106e-4a2c-beba-9e7658748a11"
}
```

12 只是示例。公共 DTO 仍接受 history 以兼容旧请求，但 ChatHistoryService 实际只读数据库最近最多 8 条，每条最多 4000 个 Unicode 字符。不能让浏览器提供可信历史。Python 再限制最近消息并只改写检索问题，历史答案不进入最终事实 Context。

## 快照与恢复

回答正文完整保存于 content；sources_json 保存卡片、来源、查询意图等元数据和每个引用最多 400 字符。去掉 answer、rewrittenQuery、retrievalCount/rerankCount/usedContextCount，引用去掉 score/rerankScore，不保存全量调试 Chunk 或向量。显式 knowledgeBaseId 额外保留以供重新生成。

来源是当时快照，文件和模板 ID 可能已经失效，历史卡片不保证等于最新事项。快照没有原始评分，前端无法重新计算实时回答中的同一最佳引用；不会把历史摘要写成完整原文或政策版本。

浏览器只在 localStorage 保存 `campusagent:last-conversation:<userId>`，不以本地正文为权威。当前学生主动提交登录表单后进入空白新对话，最近对话仍可手动打开；刷新和从其他页面返回按地址 `/#/qa?conversation=<id>` 或保存 ID 恢复。管理员首页加载本人历史列表。当前页面没有“无效 ID 自动加载最新会话”的全面兜底承诺。

pending 时前端约 1.8 秒轮询；组件/用户/会话变化使旧响应失效。新建对话保留旧记录；删除需确认。禁止浏览器存储仍可从服务器列表手动打开。

## 重新生成

只允许本人 ASSISTANT 消息。使用其配对原问题、原问题之前最近最多 8 条历史以及已保存知识库 ID，追加新 USER/ASSISTANT，保留原答案和评价。不把之后的其他话题混入旧问题上下文。升级前缺知识库 ID 的回答按默认范围处理；新回复没有旧评价。

重生成继续使用 UUID 去重与会话锁，不是覆盖原消息，也不是“原地编辑回答”。

## 验收

按 [统一启动](service-application-startup.md) 准备环境，创建两段对话、刷新/页面返回/重新登录后从列表打开、切换和删除；两个学生及管理员分别验证归属；AI 失败应只保留 USER，发送途中返回应同步完成结果。来源、办事卡片和准备清单也需检查。

自动测试为 ChatHistoryIntegrationTest、ReplyFeedbackIntegrationTest 和 frontend 的 workspace.chat-workspace.e2e.mjs。标准命令见 [总览](../README.md#验证)。旧 useChatHistory.ts/chatHistory.e2e.mjs 不再存在，不保留旧命令。当前验证结果集中在 [文档索引](README.md#本次检查与验证)，本次没有写入真实会话。
