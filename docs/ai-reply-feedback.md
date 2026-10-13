# AI 回复评价与质量分析

学生和管理员可对本人已保存的 AI 回复评价，刷新/历史切换从 MySQL 恢复。管理员质量分析需 ADMIN 角色和显式数据范围授权，Python 不访问评价表，也不自动分析差评原因。

## 用户行为与统计

回复操作依次为复制、评价、分享、重新生成、更多。评价为 POSITIVE（回复优秀）/NEGATIVE（回复不佳）；再次点优秀可取消，不佳打开详情弹窗可编辑，通过更多取消。原因和说明都可选，说明最多 2000 字符。

用户原因枚举为 INCORRECT、NOT_HELPFUL、OUTDATED、SLOW_OR_ERROR、STYLE、SAFETY、OTHER，可多选。后端校验枚举、去重并按固定顺序保存；优秀不能带原因/说明。失败保留原界面状态，历史数据是权威来源。

一条用户/消息只有一份有效评价，不存改评事件流水。完全相同请求不增加数量或更新评价时间；类型、原因或说明变化更新 updated_at，并清空原管理员分类/状态/备注。取消删除评价，不删回答。重生成追加新一轮，旧答案与评价保留，见 [聊天历史](chat-history.md)。

累计评价数是当前仍有效记录，好评率=POSITIVE/有效数×100%；无数据页面显示 —。统计、分布和列表同受类型/日期/权限范围限制；日期按评价 updated_at，包含开始/结束日。管理员处理不修改评价时间。未筛日期时统计全部有效记录，趋势最近 30 天，指定趋势最长 366 天，空日期补零。没有 AI 客观准确率、性能或自动归因指标。

## 接口与表

| 方法 | 路径 | 请求或结果 |
| --- | --- | --- |
| PUT | /api/chat/messages/{id}/feedback | rating、可选 reasons/comment → rating/updatedAt/reasons/comment |
| DELETE | /api/chat/messages/{id}/feedback | 取消本人 ASSISTANT 评价 |
| GET | /api/chat/conversations/{id}/messages | 每条消息含 feedback 或 null |
| POST | /api/chat/messages/{id}/regenerate | requestId → 新问题/回答 ID 与原问答字段 |
| GET | /api/admin/ai-quality/summary | rating/startDate/endDate 可选，统计、accessScope、trend |
| GET | /api/admin/ai-quality/feedback | 同上加 page/pageSize，默认 20、最多 100 |
| PATCH | /api/admin/ai-quality/feedback/{id} | issueType、handlingStatus、adminNote、version |

JSON 包在 ApiResponse.data，写接口需登录 Cookie/CSRF。用户只能评价本人 ASSISTANT，别人的消息、USER 和不存在消息返回 404。提交/取消使用所属会话行锁，避免并发和会话删除冲突。

V9：ai_reply_feedback、ai_feedback_admin_access、ai_feedback_admin_user_scope、ai_feedback_schema_state；V12：ai_reply_feedback_detail。用户原因/说明与管理员分类/备注分别保存。唯一键 (user_id,message_id)，关联用户/消息删除级联。

管理员分类为 UNCLASSIFIED、KNOWLEDGE_GAP、RETRIEVAL_MISMATCH、ANSWER_QUALITY、OTHER，状态为 OPEN、IN_PROGRESS、RESOLVED，备注最多 2000 字符。只处理当前差评，版本冲突为 409 FEEDBACK_CHANGED。引用显示聊天 sources_json 摘要（每段最多 400 字符）和办事来源，不是重新调用模型产生的诊断。

## 管理员数据范围

权限表 scope 只有 ALL 和 ASSIGNED，当前没有学院/部门组织模型。缺权限行返回 403 FEEDBACK_SCOPE_REQUIRED，范围外记录 404。请求中的 userId/scope 不能扩大权限，统计/趋势/列表/处理共用范围。

V9 首次执行给当时已有 ADMIN 授 ALL，并写一次性 schema_state；后来新增、撤销或重启不会静默补权限。先启动建表再 Seed 的新管理员必须显式授权。

在实际 MySQL 选择需要的 SQL，替换账号：

```sql
INSERT INTO ai_feedback_admin_access(admin_id,access_scope)
SELECT id,'ALL' FROM user_account WHERE username='实际管理员账号' AND role='ADMIN'
ON DUPLICATE KEY UPDATE access_scope='ALL';
```

限定某些用户：

```sql
INSERT INTO ai_feedback_admin_access(admin_id,access_scope)
SELECT id,'ASSIGNED' FROM user_account WHERE username='实际管理员账号' AND role='ADMIN'
ON DUPLICATE KEY UPDATE access_scope='ASSIGNED';

INSERT IGNORE INTO ai_feedback_admin_user_scope(admin_id,user_id)
SELECT a.id,u.id FROM user_account a CROSS JOIN user_account u
WHERE a.username='实际管理员账号' AND a.role='ADMIN' AND u.username='实际学生账号';
```

ASSIGNED 无映射时为零数据。删除 access 或 user_scope 行可撤销相应范围；不需要删除用户聊天。配置由数据库维护者负责，尚无授权管理 UI。

## 启动与验收

统一准备见 [启动文档](service-application-startup.md)。评价历史、恢复和质量分析不依赖 AI 服务；新问答/重新生成 RAG 需要 Python 和千问。页面为 /#/qa 和 /#/ai-quality，不存在第二套静态入口。

手工检查逐条优秀/不佳、原因编辑、取消、重复提交、断网回滚、历史切换、重新登录打开历史与重生成保留旧评价；管理员核对同一组记录的计数、日期、趋势、分页与引用，再处理差评，两个旧编辑版本应冲突。两名学生、ALL/ASSIGNED/无授权管理员分别检查权限。公开分享不包含评价、用户说明或处理备注。

自动测试为 ReplyFeedbackIntegrationTest，以及 frontend 的 workspace.feedback-profile.e2e.mjs 与 workspace.chat-workspace.e2e.mjs。标准命令见 [总览](../README.md#验证)。当前测试结果集中在 [索引](README.md#本次检查与验证)，不沿用旧双前端验收数字。

可选真实 Java/MySQL/Vue 联调命令从根目录运行：

```powershell
node scripts/test-reply-feedback-live.mjs
```

需要已构建 JAR、frontend/npm 依赖、MySQL CLI 和可创建/删除临时库的账号。使用 18080/18000/15173，AI 为 HTTP 替身；脚本创建并在 finally 删除 campus_feedback_test_<时间戳>，截图在 tmp/feedback-browser。完整变量见 [脚本说明](../scripts/README.md)。本次未执行此脚本，不证明真实 Qwen 质量。
