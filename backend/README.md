# CampusAgent Java Backend

这是 Maven 多模块的 Spring Boot 模块化单体。`campus-app` 是唯一启动模块，其他模块不能自行成为 Spring Boot 应用。

办事引导 V1：`campus-affair` 新增事项/步骤管理；`campus-ai-integration` 在原 `/api/rag/chat` 中进行识别与分流，未命中仍使用原 RAG。新增 `/api/services`、`/api/admin/services`；启动时自动执行幂等 V3 建表，示例数据单独导入。完整说明见 [开发与验收文档](../docs/service-guide-v1.md)。从仓库根目录执行 `scripts/start-backend.ps1 -Build` 可读取 backend/.env 并构建启动。

## 构建与启动

```bash
mvn clean package
java -jar campus-app/target/campus-app-0.1.0-SNAPSHOT.jar
```

运行环境通过 `DB_URL`、`DB_USERNAME`、`DB_PASSWORD`、`SERVER_PORT` 配置。认证必须额外设置 `JWT_SECRET`（至少 32 随机字节的 Base64），可配置 `JWT_EXPIRE_MINUTES`、`AUTH_COOKIE_SECURE`、`AUTH_ALLOWED_ORIGINS`。新库和旧库启动均自动执行 V5 创建账号及可撤销登录会话表；不会自动创建默认账号。具体启动与账号 SQL 见 [统一登录文档](../docs/auth-rbac.md)。知识库检索还使用：

- `AI_SERVICE_BASE_URL`：Python AI 服务地址，默认 `http://localhost:8000`；
- `KNOWLEDGE_DEFAULT_TOP_K`：请求未传 `topK` 时的默认值，默认 5；
- `KNOWLEDGE_MAX_TOP_K`：Java API 允许的最大值，默认 20，应与 AI 服务配置保持一致。
- `AI_SERVICE_RAG_TIMEOUT_SECONDS`：Java 等待 Python RAG 请求的超时，默认 90 秒。

`.env.example` 仅作变量说明，Spring Boot 不会自动读取 `.env` 文件。

健康检查：`GET /api/v1/health`。

知识库检索：`POST /api/knowledge/search`。

```json
{
  "query": "国家奖学金申请需要满足什么条件？",
  "topK": 5
}
```

浏览器仍只访问 Java 后端。`campus-ai-integration` 模块负责校验检索请求并调用
`POST /internal/v1/knowledge/search`，Python 内部地址不会暴露给前端。

RAG 问答：`POST /api/rag/chat`，请求 `{"query":"心理测评时间是什么时候？"}`；可选 `knowledgeBaseId`。Java 只负责校验、转发和错误包装，千问 Key 配置在 Python AI 服务中。

多轮问答可选传入 `history`，格式为 `[{"role":"user","content":"2026级新生心理测评什么时候？"},{"role":"assistant","content":"2026年9月19日至22日。"}]`。Java 将历史文本转发 Python；查询改写和历史截断在 Python 完成。旧请求不传 `history` 仍走单轮 RAG。响应增加 `rewrittenQuery` 供调试。

## 管理员文档 API

浏览器通过 Java 的 `/api/admin` 访问知识库管理；Python 内部接口不向浏览器开放。启动时 `schema.sql` 创建 `knowledge_document`，MySQL 数据库本身需提前创建。配置 `ADMIN_MAX_UPLOAD_SIZE_MB`（默认 20）、`ADMIN_DOCUMENT_STORAGE_PATH`（默认 `var/documents`）、`ADMIN_KNOWLEDGE_BASE_ID`（默认 `campus-default`）。原文件目录需要持久化并定期备份，以支持重新解析。Java 与 AI 服务最大上传限制须保持一致。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/admin/overview` | 真实状态统计和最近 7 份文档 |
| GET | `/api/admin/config` | 上传上限 |
| GET | `/api/admin/documents` | `search`、`type`、`status`、`page`、`pageSize` 分页查询 |
| GET | `/api/admin/documents/{id}` | 文档详情与失败原因 |
| GET | `/api/admin/documents/{id}/progress` | 当前阶段、页数与处理进度 |
| POST | `/api/admin/documents` | `multipart/form-data` 单文件上传；前端逐文件批量调用 |
| PATCH | `/api/admin/documents/{id}/name` | JSON `{ "name": "新名称" }`，同步引用元数据 |
| POST | `/api/admin/documents/{id}/reprocess` | 后台重新解析同一文档 |
| DELETE | `/api/admin/documents/{id}` | 删除向量、原文件、元数据 |

上传响应 `data` 为 `{ "duplicate": false, "taskId": "文档ID", "documentId": "文档ID", "status": "PROCESSING", "document": {...} }`，保存文件后即返回；重复文件返回 `duplicate: true` 和已存在文档，不重复生成向量。后台最多同时处理 2 份文档，等待队列上限 16。`status` 保持旧接口的 `PROCESSING` / `SUCCESS` / `FAILED`，`parseStatus` 给出更细的阶段。前端每 1.5 秒轮询进度。失败详情仅显示友好提示，异常堆栈留在日志。已有数据库升级前须执行 [V2 迁移 SQL](campus-app/src/main/resources/db/migration/V2__document_ocr_progress.sql)；新数据库由 `schema.sql` 建表。`/api/admin/**` 通过统一登录 + JWT HttpOnly Cookie + CSRF + 数据库 ADMIN 角色保护。旧 HTTP Basic 已移除；先配置 `JWT_SECRET` 并按 [账号管理指南](../docs/auth-rbac.md) 初始化账号。API 客户端先 GET `/api/auth/csrf`，再携带 Cookie 和返回的 CSRF header/token POST `/api/auth/login`。

## 材料附件

任意事项的每项材料可关联一个模板附件，V4 在启动时自动建表；原材料 JSON 保持兼容。默认存储目录为 `ADMIN_DOCUMENT_STORAGE_PATH/materials`，可配置 `MATERIAL_UPLOAD_DIR`。支持 DOC / DOCX / PDF / XLS / XLSX / ZIP，复用单文件大小限制（默认 20 MB），不进入知识库解析。

数据库迁移、完整 API、权限配置、启动与验收见 [材料附件说明](../docs/material-attachments.md)。
