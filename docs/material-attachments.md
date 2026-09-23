# 所需材料附件 / 表格模板下载

已实现所有办事事项通用的「一个材料关联零个或一个附件」。不根据事项名称判断、不在前端写死文件地址，不向知识库或 RAG 导入模板。

## 数据与迁移

项目原有 `service_item.materials` 是 JSON 数组，没有独立材料 Entity / 表。本次保留原结构，为材料 JSON 增加稳定 `id`，接口增加可空 `attachment`；不删除或重建已有表。

旧材料读取时按事项 ID 和原始数组位置生成确定性 UUID。首次上传或保存事项时将 ID 写回 JSON，之后重排、改名仍使用该 ID。未带 ID 的旧客户端按唯一材料名称匹配；客户端不得把其他事项的材料 ID 带入当前事项。附件信息只从附件表生成，忽略事项保存请求中的 `attachment`，防止旧编辑页面覆盖刚上传的附件。

新增 `service_material_attachment` 表：

| 字段 | 用途 |
| --- | --- |
| `id CHAR(36)` | 文件 UUID 主键，同时是磁盘文件名 |
| `service_item_id BIGINT` | 所属事项，外键关联 `service_item.id` |
| `material_id CHAR(36)` | 所属材料的稳定 ID |
| `original_filename VARCHAR(255)` | 原始显示 / 下载名称 |
| `content_type VARCHAR(160)` | 根据允许格式生成的规范 MIME |
| `file_size BIGINT` | 文件字节数 |
| `created_at` / `updated_at` | 创建 / 更新时间 |

`(service_item_id, material_id)` 唯一，保证每个材料最多一个附件。材料 JSON 不存磁盘路径，返回的附件也不包含物理目录。

完整 SQL：[V4__material_attachments.sql](../backend/campus-app/src/main/resources/db/migration/V4__material_attachments.sql)。继续复用 Spring SQL 初始化；**不需要安装 Flyway**。启动顺序为 `schema.sql → V3 → V4`，建表 SQL 可重复执行。本次真实 MySQL 启动验收已执行 V4。

手动迁移：在仓库根目录打开 MySQL 客户端，选择实际业务数据库后执行：

```sql
USE campus_agent;
SOURCE backend/campus-app/src/main/resources/db/migration/V4__material_attachments.sql;
```

已有办事指南数据库只需 V4；更早版本需先满足原有 V2、V3 升级要求。V4 不要求给旧 JSON 批量补字段，也不会插入示例事项。

## 存储、格式与一致性

原知识库服务没有独立存储服务。本次将其 UUID 磁盘读写提取为 `campus-shared` 的 `LocalFileStorage`，由知识库和材料附件共同复用；知识库既有文件位置保持有效。

材料附件默认保存在 `${ADMIN_DOCUMENT_STORAGE_PATH}/materials/<UUID>`。从 `backend` 目录启动且使用默认配置时，就是 **`backend/var/documents/materials/<UUID>`**。可通过 `MATERIAL_UPLOAD_DIR` 覆盖目录；相对路径始终相对于 Java 启动工作目录。

支持 `.doc / .docx / .pdf / .xls / .xlsx / .zip`，扩展名不区分大小写，默认单文件 **20 MB**。复用 `ADMIN_MAX_UPLOAD_SIZE_MB`（1–100 MB）；multipart 请求上限 101 MB，为单文件上限预留请求头开销。知识库仍使用原解析白名单，新增模板类型不会改变 RAG 文档解析能力。

服务端校验扩展名、空文件、大小、文件签名，DOCX / XLSX 检查 Office 包的清单和主文档。ZIP 扫描限制 4096 项及 100 MB 解压总量，不将任何 ZIP 内容解压到磁盘。DOC / XLS 校验 OLE 容器签名，不进行 Office 语义解析或病毒扫描。

原始名称只用于显示，剥离目录部分并拒绝控制字符；磁盘以 UUID + `CREATE_NEW` 写入，避免覆盖和同名冲突。附件和事项定义写操作共用父事项行锁。替换先保存新文件、再提交新关联，事务回滚清理新文件；提交后清理旧文件。删除附件只删除附件关联，不删除材料；删除材料或事项也清理对应附件。附件操作不增加流程 `version`，不重置学生办理进度。

若提交后的磁盘清理因权限 / 磁盘故障失败，会记录 `Attachment file cleanup pending id=...`，旧文件已不能通过 API 下载，可由运维对照附件表清理磁盘孤立文件。进程在文件写入与事务结束之间被强制终止也可能留下孤立文件；本版未引入后台清理任务。

## API

遵循现有 `ApiResponse`：成功对象位于 `data`。路径参数中的材料 ID 来自事项接口，不能使用材料名称或前端数组下标。

| 方法 | 路径 | 权限与行为 |
| --- | --- | --- |
| GET | `/api/admin/session` | 验证管理员账号，返回用户名与 CSRF token/header |
| GET | `/api/admin/material-attachments/config` | 管理员读取扩展名白名单及单文件上限 |
| POST | `/api/admin/services/{serviceId}/materials/{materialId}/attachment` | 管理员上传 / 替换；multipart 的字段为 `file` |
| DELETE | 同上 | 管理员删除附件；材料保留 |
| GET | `/api/files/{id}/download` | 仅下载当前已启用事项仍关联的附件 |
| GET | `/api/admin/files/{id}/download` | 管理员下载，也支持草稿 / 停用事项 |

已有 `/api/services/{id}`、`/api/admin/services/{id}` 和办事引导 `/api/rag/chat` 的 `service.materials` 同时带回附件：

```json
{
  "id": "材料UUID",
  "name": "学生证补办申请表",
  "description": "请填写完整",
  "required": true,
  "attachment": {
    "id": "文件UUID",
    "filename": "学生证补办申请表.docx",
    "downloadUrl": "/api/files/文件UUID/download"
  }
}
```

无附件时 `attachment: null`。下载按文件 ID 查元数据并验证事项状态和材料关联，再读取服务器文件。返回规范 `Content-Type`、`Content-Length`、`Content-Disposition: attachment` 及 UTF-8 `filename*`；同时设置 `nosniff` 和 `Cache-Control: no-store`。中文和空格均保留原名称。

前端复用 Axios 下载 Blob，读响应中的文件名，通过浏览器下载机制保存，不跳转新页面。失败统一显示「文件下载失败，请稍后重试。」下载链接阻止事件冒泡，不触发材料复选框。

## 管理员认证

原项目没有登录鉴权，经确认使用环境变量管理员账号和 Spring Security HTTP Basic，身份模块负责认证，**整个 `/api/admin/**` 都要求 ADMIN 权限**。未配置账号 / 密码时拒绝管理访问；没有默认密码或新的账号表。学生查询、问答和已启用事项附件下载维持公开访问。

管理员页面先显示账号验证面板；凭据仅保存在当前页面内存中，不存入 localStorage/sessionStorage，不写入前端环境变量，不随学生 API 发送。刷新或离开管理布局需要重新验证。

保留 Spring Security 的 CSRF 防护。浏览器 / API 客户端先带 HTTP Basic 请求 `/api/admin/session`，保留返回的会话 Cookie，再将返回的 `csrfToken` 按 `csrfHeader` 写入管理变更请求，同时继续发送 HTTP Basic。生产部署需使用 HTTPS。配置依据：[Spring Security Java 配置](https://docs.spring.io/spring-security/reference/servlet/configuration/java.html)、[CSRF](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html)。

## 配置与启动

`backend/.env.example` 已同步新增配置。在本地 `backend/.env` 设置自己的值（不要提交凭据）：

```dotenv
ADMIN_USERNAME=your-admin-name
ADMIN_PASSWORD=your-private-password
ADMIN_MAX_UPLOAD_SIZE_MB=20
ADMIN_DOCUMENT_STORAGE_PATH=var/documents
# 可选，省略时使用知识库目录下的 materials 子目录
# MATERIAL_UPLOAD_DIR=var/documents/materials
```

1. 保持原有 MySQL 的 `DB_URL / DB_USERNAME / DB_PASSWORD` 配置。
2. 从仓库根目录运行 `./scripts/start-backend.ps1 -Build`，读取 `backend/.env`、构建并启动 Java，自动执行 V4。
3. 另开终端进入 `frontend`，执行 `npm install`（已有依赖可省略）、`npm run dev`。
4. 访问 `http://localhost:5173/admin/services`，输入上面配置的管理员账号。
5. 如需完整 AI 问答，按原 README 启动 Python：进入 `ai-service` 后运行 `.venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000`。附件功能不依赖 AI 服务；明确匹配事项的办事引导在 AI 离线时仍可返回数据库数据。

## 管理与手动验收

附件操作立即生效，页面有对应提示；事项字段和步骤仍通过「保存事项与步骤」提交。新建事项 / 新增材料先保存，然后重新编辑上传附件。编辑期间取消事项修改不会撤销已经完成的附件操作。

1. 编辑「学生证补办」，在「学生证补办申请表」下点「上传附件」，选择有效的 `学生证补办申请表.docx`。应显示名称、下载、替换、删除附件。
2. 用学生页面查询「学生证丢了怎么办？」。申请表描述下应显示蓝色「下载：学生证补办申请表.docx」，悬停有下划线。
3. 点击下载，浏览器直接保存，名称保持中文，使用 Word / WPS 打开核对内容。下载不影响材料勾选。
4. 身份证明、证件照无附件时，学生页面不显示下载入口或「暂无附件」。
5. 管理员替换为 `新版 学生证补办申请表.docx`；学生刷新页面重新查询，只显示新版名称。旧文件 URL 返回 404。
6. 管理员点「删除附件」并确认；学生刷新重新查询，链接消失，但申请表材料仍在。
7. 换另一事项上传同名文件，确认两个附件互不覆盖。中文、空格文件名均能正常下载。
8. 上传 EXE、空文件、超过限制的文件、伪装成 DOCX 的文本，应被拒绝，原附件保持可用。
9. 无管理员凭据调用上传 / 删除 API，应返回 401 或 403；有效管理员凭据但缺 CSRF 也会被拒绝。
10. 已启用事项改成草稿 / 停用后，学生下载返回 404，管理员仍能下载。已打开的旧卡片点击失效地址显示友好错误。

## 自动测试

- `backend`：`mvn test`；构建为 `mvn package`。集成测试使用 H2 的 MySQL 模式及真实 Spring Security 过滤链、事务和临时文件目录，不需要线上凭据。
- `frontend`：`npm run build`、`npm test`。
- `ai-service`：`.venv/Scripts/python.exe -m pytest -q --basetemp ../tmp/pytest-material-attachments`。
- 浏览器真实服务验收：先运行 `python scripts/create-material-test-fixtures.py`，准备 Playwright / Edge，设置 `CAMPUS_BASE_URL` 为实际前端地址、`ADMIN_USERNAME / ADMIN_PASSWORD` 为测试管理员凭据，然后运行 `node frontend/tests/browser/materialAttachments.e2e.mjs`。如 Playwright 不在原项目测试目录，设置 `PLAYWRIGHT_MODULE_PATH` 为其 `index.mjs` 路径。脚本创建独立事项并在 finally 中删除；不修改现有事项。

本次已完成真实 MySQL + Edge 流程测试：上传、管理员下载、学生蓝色链接、中文 / 空格文件名、下载字节一致、无附件隐藏、勾选保留、替换、删除、失效链接提示、移动端及权限拦截。下载的 DOCX 与有效 Office Open XML 测试源文件逐字节一致；未自动驱动 Word / WPS 桌面应用。截图保存在本地 `tmp/material-browser/`。

验证结果：后端 75 项测试通过（含 8 项附件集成测试），前端 26 项测试及生产构建通过，Python 136 项测试通过。前端构建仍提示 Element Plus 公共包体积较大；Python 有一项现有依赖警告，均未导致失败。

## 修改文件清单

- [.gitignore](../.gitignore)
- [README.md](../README.md)
- [backend/.env.example](../backend/.env.example)
- [backend/README.md](../backend/README.md)
- [backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/controller/MaterialAttachmentController.java](../backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/controller/MaterialAttachmentController.java)
- [backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/dto/MaterialAttachmentDTO.java](../backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/dto/MaterialAttachmentDTO.java)
- [backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/dto/ServiceItemDTO.java](../backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/dto/ServiceItemDTO.java)
- [backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/repository/MaterialAttachmentRepository.java](../backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/repository/MaterialAttachmentRepository.java)
- [backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/repository/ServiceItemRepository.java](../backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/repository/ServiceItemRepository.java)
- [backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/service/MaterialAttachmentService.java](../backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/service/MaterialAttachmentService.java)
- [backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/service/MaterialFileValidator.java](../backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/service/MaterialFileValidator.java)
- [backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/service/ServiceGuideService.java](../backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/service/ServiceGuideService.java)
- [backend/campus-affair/src/test/java/com/campusagent/affair/serviceguide/ServiceGuideTest.java](../backend/campus-affair/src/test/java/com/campusagent/affair/serviceguide/ServiceGuideTest.java)
- [backend/campus-app/pom.xml](../backend/campus-app/pom.xml)
- [backend/campus-app/src/main/java/com/campusagent/app/admin/AdminDocumentService.java](../backend/campus-app/src/main/java/com/campusagent/app/admin/AdminDocumentService.java)
- [backend/campus-app/src/main/resources/application.yml](../backend/campus-app/src/main/resources/application.yml)
- [backend/campus-app/src/main/resources/db/migration/V4__material_attachments.sql](../backend/campus-app/src/main/resources/db/migration/V4__material_attachments.sql)
- [backend/campus-app/src/test/java/com/campusagent/app/serviceguide/MaterialAttachmentIntegrationTest.java](../backend/campus-app/src/test/java/com/campusagent/app/serviceguide/MaterialAttachmentIntegrationTest.java)
- [backend/campus-app/src/test/resources/material-test-schema.sql](../backend/campus-app/src/test/resources/material-test-schema.sql)
- [backend/campus-identity/pom.xml](../backend/campus-identity/pom.xml)
- [backend/campus-identity/src/main/java/com/campusagent/identity/AdminSecurityConfiguration.java](../backend/campus-identity/src/main/java/com/campusagent/identity/AdminSecurityConfiguration.java)
- [backend/campus-identity/src/main/java/com/campusagent/identity/AdminSessionController.java](../backend/campus-identity/src/main/java/com/campusagent/identity/AdminSessionController.java)
- [backend/campus-shared/src/main/java/com/campusagent/shared/storage/LocalFileStorage.java](../backend/campus-shared/src/main/java/com/campusagent/shared/storage/LocalFileStorage.java)
- [frontend/src/modules/admin/AdminLayout.vue](../frontend/src/modules/admin/AdminLayout.vue)
- [frontend/src/modules/admin/components/AdminAccessGate.vue](../frontend/src/modules/admin/components/AdminAccessGate.vue)
- [frontend/src/modules/serviceguide/api.ts](../frontend/src/modules/serviceguide/api.ts)
- [frontend/src/modules/serviceguide/components/MaterialAttachmentEditor.vue](../frontend/src/modules/serviceguide/components/MaterialAttachmentEditor.vue)
- [frontend/src/modules/serviceguide/components/MaterialDownloadLink.vue](../frontend/src/modules/serviceguide/components/MaterialDownloadLink.vue)
- [frontend/src/modules/serviceguide/components/ServiceGuideCard.vue](../frontend/src/modules/serviceguide/components/ServiceGuideCard.vue)
- [frontend/src/modules/serviceguide/pages/ServiceManagementPage.vue](../frontend/src/modules/serviceguide/pages/ServiceManagementPage.vue)
- [frontend/src/modules/serviceguide/types.ts](../frontend/src/modules/serviceguide/types.ts)
- [frontend/tests/browser/materialAttachments.e2e.mjs](../frontend/tests/browser/materialAttachments.e2e.mjs)
- [scripts/create-material-test-fixtures.py](../scripts/create-material-test-fixtures.py)

另新增本说明 `docs/material-attachments.md`。
