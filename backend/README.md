# CampusAgent Java 后端

这是 Maven 多模块的 Spring Boot 模块化单体，`campus-app` 是唯一启动模块。Java 负责身份、业务事实、MySQL、文件保存和 AI 调用，Python 负责解析与模型能力。JDK 21、Spring Boot 3.5.16、MyBatis-Plus 3.5.17 的声明见 [pom.xml](pom.xml)；现有 Repository 主要使用 JdbcTemplate，不应按依赖名称把它们描述成 MyBatis Mapper。

## 模块与调用关系

| 模块 | 当前实现 |
| --- | --- |
| campus-app | 启动和装配、知识库管理、原文件接口、健康检查、SQL 与集成测试 |
| campus-shared | ApiResponse、业务异常、全局错误映射、LocalFileStorage |
| campus-identity | 数据库账号、BCrypt、JWT Cookie、CSRF、会话撤销、用户资料读取和本地工具 |
| campus-affair | 事项目录、规则识别、步骤、模板附件、申请、要求快照和审核 |
| campus-ai-integration | AI HTTP 客户端、问答分流、聊天历史、重新生成、分享、反馈与质量统计 |
| campus-policy / campus-question / campus-audit | 仅有预留包和 Maven 模块，尚无独立业务实现 |

`campus-ai-integration` 通过事项服务、DTO 和语义匹配接口调用 `campus-affair`；`campus-app` 组合事项来源和文档文件服务。当前申请实现位于同一 affair 模块，直接调用其事项 Repository。聊天和反馈实际位于 ai-integration，知识文档实际位于 app，不能把预留模块画成已运行服务。

## 构建与启动

在 backend 目录：

```powershell
mvn package
java -jar campus-app/target/campus-app-0.1.0-SNAPSHOT.jar
```

直接运行前需设置进程环境。Spring Boot 不读取 `.env`。Windows 从仓库根目录使用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1 -Build
```

脚本加载 backend/.env，在 backend 工作目录构建并运行；已构建后的启动可省略 -Build，但源码变化不会自动触发重新打包。首次准备见 [完整启动说明](../docs/service-application-startup.md)。

## 运行配置

以 [application.yml](campus-app/src/main/resources/application.yml) 和 [.env.example](.env.example) 为准。

| 环境变量 | 默认值或要求 |
| --- | --- |
| DB_URL | localhost:3306/campus_agent 的 MySQL JDBC 地址，详细参数见配置文件 |
| DB_USERNAME / DB_PASSWORD | campus_agent / 空；实际环境必须填写可连接的凭据 |
| SERVER_PORT | 8080 |
| JWT_SECRET | 必填，至少 32 随机字节的 Base64；不合格会拒绝启动 |
| JWT_EXPIRE_MINUTES | 120，允许 1–10080 |
| AUTH_COOKIE_SECURE | false；HTTPS 部署设 true |
| AUTH_ALLOWED_ORIGINS | http://localhost:5173,http://127.0.0.1:5173 |
| AI_SERVICE_BASE_URL | http://localhost:8000 |
| AI_SERVICE_RAG_TIMEOUT_SECONDS | 90，RAG 客户端连接及读取超时 |
| SERVICE_GUIDE_AI_TIMEOUT_SECONDS | 12，办事 AI 客户端读取超时，连接超时固定 2 秒 |
| KNOWLEDGE_DEFAULT_TOP_K / KNOWLEDGE_MAX_TOP_K | 5 / 20，与 Python 检索限制协调 |
| ADMIN_MAX_UPLOAD_SIZE_MB | 20，模板与申请服务校验 1–100 MB；multipart 总请求上限固定 101 MB |
| ADMIN_DOCUMENT_STORAGE_PATH | var/documents，相对于 Java 工作目录 |
| ADMIN_KNOWLEDGE_BASE_ID | campus-default，application.yml 支持，.env.example 未列出 |
| MATERIAL_UPLOAD_DIR | 默认知识文件目录的 materials 子目录 |
| APPLICATION_UPLOAD_DIR | 默认知识文件目录的 applications 子目录 |

文档 AI 客户端连接超时固定 15 秒、读取超时 3 小时，不受 RAG 的 90 秒配置控制。普通检索客户端没有设置专用业务超时，不应承诺与 RAG 相同。

## 数据库设计与升级

数据库由部署者提前创建，启动只执行表初始化。当前 `spring.sql.init.mode=always`，依次执行 `schema.sql` 和 V3–V12；没有 Flyway/Liquibase 或完整迁移历史表。V2 没有加入启动列表。

| SQL | 表和作用 |
| --- | --- |
| schema.sql | knowledge_document：UUID、知识库、文件属性/hash、处理状态、页数和进度 |
| V2__document_ocr_progress.sql | 早期旧表增加五个进度字段；仅缺字段的旧库人工升级，不可重复执行 |
| V3__service_guide.sql | service_item、service_step：事项条件/材料/规则 JSON、来源、状态、版本、有序步骤 |
| V4__material_attachments.sql | service_material_attachment：每项材料最多一个模板附件 |
| V5__auth_rbac.sql | user_account、user_login_session：账号、BCrypt、角色和可撤销会话 |
| V6__service_application.sql | service_application、service_application_attachment、service_application_event |
| V7__chat_history.sql | ai_conversation、ai_message：归属、生成锁、请求唯一键、消息和引用快照 |
| V8__conversation_share.sql | ai_conversation_share：token、范围、撤销、过期和访问计数 |
| V9__reply_feedback.sql | ai_reply_feedback、ai_feedback_admin_access、ai_feedback_admin_user_scope、ai_feedback_schema_state |
| V10__application_materials.sql | service_application_material、service_application_attachment_material |
| V11__user_profile.sql | user_profile：可选部门、专业、班级 |
| V12__reply_feedback_details.sql | ai_reply_feedback_detail：用户原因和说明 |

完整文件在 [db/migration](campus-app/src/main/resources/db/migration)。新库共 20 张表。外键和 CHECK 是业务保护的一部分，数据库版本和实际约束执行情况需在目标环境确认。

文档以 `(knowledge_base_id,file_hash)` 去重。事项 code 唯一；材料留在 JSON，模板表用 `(service_item_id,material_id)` 唯一关联。申请用 `(user_id,service_item_id,active_slot)` 防止重复在办，审核用行锁和 version。聊天用 `(conversation_id,request_id,role)` 去重，评价用 `(user_id,message_id)` 唯一键。

删除知识文档会将事项来源 ID 置空；删除会话级联清理消息、分享和评价。有申请的事项/用户受申请和事件外键约束，不能宣称删除账号只清理登录会话即可。日常停用账号优先使用 DISABLED。

五项演示事项和账号模板在 [db/seed](campus-app/src/main/resources/db/seed)，均不自动加载。服务启动不会创建账号；质量分析 V9 只在第一次初始化时给当时已有 ADMIN 授权，后续账号必须显式授权。

## 对外接口

普通 JSON 返回 `code/message/data/requestId/timestamp`；文件接口直接返回文件。成功业务数据在 data。Java requestId、聊天幂等 requestId 和 Python requestId 目前不是完整跨服务 trace，不能混为一个标识。

认证 Cookie 为 CAMPUS_AUTH，HttpOnly、SameSite=Lax、Path=/api。所有写请求，包括登录/退出，都需要 CSRF。登录后重新 GET /api/auth/csrf 获取已轮换的 token。具体权限与账号操作见 [认证说明](../docs/auth-rbac.md)。

| 接口组 | 主要路径 | 权限与详情 |
| --- | --- | --- |
| 健康、认证 | /api/v1/health、/api/auth/csrf、login、me、logout | 公开健康/CSRF；me 需登录；无注册/改密接口 |
| 检索与聊天 | POST /api/knowledge/search、POST /api/rag/chat | STUDENT 或 ADMIN，[AI 说明](../ai-service/README.md) |
| 事项 | /api/services、/{id}、/{id}/steps、/recognize、/{id}/source | 已启用事项，[办事引导](../docs/service-guide-v1.md) |
| 事项管理 | /api/admin/services、/{id} | ADMIN，创建/整体保存/删除需版本校验 |
| 模板 | /api/admin/services/{sid}/materials/{mid}/attachment、/api/files/{id}/download | 详见 [模板附件](../docs/material-attachments.md) |
| 申请 | /api/student/applications、/api/admin/applications | STUDENT 创建本人申请，ADMIN 审核，[申请说明](../docs/service-application.md) |
| 历史、分享 | /api/chat/conversations、/api/share/chat/{token} | 本人历史；仅 GET 公开 token，[历史](../docs/chat-history.md)、[分享](../docs/chat-share.md) |
| 反馈 | /api/chat/messages/{id}/feedback、/{id}/regenerate | 本人回复，[反馈说明](../docs/ai-reply-feedback.md) |
| 质量分析 | /api/admin/ai-quality/summary、/feedback、/feedback/{id} | ADMIN 且有数据范围授权 |

`/api/student/**` 仅 STUDENT，`/api/admin/**` 仅 ADMIN，其他业务 API 要求任一角色。后端无 Swagger 依赖；AI 的 OpenAPI 在 Python /docs。

## 知识文档 API 与处理

| 方法 | 路径 | 请求或用途 |
| --- | --- | --- |
| GET | /api/admin/overview | 文档状态统计、片段数、最近 7 份文档 |
| GET | /api/admin/config | maxUploadSizeMb |
| GET | /api/admin/documents | search/type/status/page/pageSize；默认 20，每页最多 100 |
| GET | /api/admin/documents/{id} | 文档元数据与错误 |
| GET | /api/admin/documents/{id}/progress | Java 最终状态和处理中进度 |
| POST | /api/admin/documents | multipart file，每次一份；页面可逐文件上传 |
| PATCH | /api/admin/documents/{id}/name | JSON `{"name":"新名称"}`，同步向量引用元数据 |
| POST | /api/admin/documents/{id}/reprocess | 重用文档 ID 和原文件，后台重新解析 |
| DELETE | /api/admin/documents/{id} | 先向量，再原文件，再元数据 |
| GET | /api/knowledge/documents/{id}/file | 登录用户预览/下载当前配置知识库的成功文档 |

新上传返回 duplicate=false、taskId、documentId、status、document；重复返回 duplicate=true 和已有 document，不保证重复响应也有 taskId。状态为 PROCESSING / SUCCESS / FAILED，parseStatus 区分具体阶段。

文件保存后进入进程内队列：2 个工作线程、16 个等待任务。队列满保留失败记录，供以后重新解析。Java 重启标记未完成记录为 FAILED，没有自动恢复任务。失败清理向量为尽力操作，异常写日志；MySQL、文件与 Chroma 之间不是原子事务。重命名有补偿，删除中途失败仍可能留下不一致，不能写成绝对一致性保证。

支持格式及 OCR 流程见 [AI README](../ai-service/README.md)。知识管理限制到 ADMIN_KNOWLEDGE_BASE_ID，但公共检索/问答的 knowledgeBaseId 仍可由客户端填写或省略，没有多知识库授权。页面问答固定提交 campus-default，修改管理知识库配置后需核对这一差异。

## 测试和限制

在 backend 运行 `mvn test`；`mvn package` 默认也执行测试。集成测试使用 H2 和模拟 AI 客户端，不操作当前学校 MySQL。当前检查结果见 [文档索引](../docs/README.md)，历史测试总数不能代替当前重跑。

尚无自助账号管理、政策版本、独立审计日志、动态设置 API、生产迁移机制或学校系统对接。前端改密文案、申请附件页面路径等不一致已记录，本次未改代码。
