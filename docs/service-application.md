# CampusAgent 在线申请与审核交付说明

## 2026-10-12 交互修复

- 静态版管理员智能问答与学生端一样提供当前步骤、完成状态、进度、回退及重置；进度按登录账号保存在当前浏览器。事项管理预览和公开分享仍保持原有用途。
- 静态版及 Vue 版为每项材料提供独立上传入口，自动关联材料 ID，显示所选文件并支持移除；必交项未上传时显示缺失项名称。补交沿用申请的材料快照，允许只上传本次需补充的材料。
- 审核在同一窗口连续确认各阶段，意见只填写一次；可以在审核中、已通过、待补材料、驳回或已完成阶段点击「提交审核结果」。提交前的步骤调整不写入数据库。
- 静态版事项编辑器为步骤标题、负责部门、预计耗时、地点、说明和材料添加常驻标签及步骤编号，填写后仍可辨识字段。已验证新增/删除时内容保留和手机端布局；Vue 版原有常驻标签保持一致。
- 新增 `PATCH /api/admin/applications/{id}/review`，请求仍为 `{status, remark, version}`。服务端在申请行锁和同一事务内，沿合法状态路径记录每次流转，意见只保存到最终流转及申请记录。支持已提交或审核中申请一次办结，也支持先审核通过、以后再办结。要求补材料和驳回必须填写原因；旧版本返回 409。原 `/status` 单步接口保留。
- 本次无需新增数据库迁移。后端需使用新打包的 JAR 重启；静态页刷新即可加载修改，Vue 版使用更新后的构建。

验证：申请后端集成测试 25 项、前端单元测试 32 项、静态材料浏览器检查 21 项、连续审核检查 19 项、问答回归检查 58 项、Vue 申请交互检查 11 项均通过，Vue 生产构建通过。浏览器验证加载实际前端代码并模拟 API；后端测试使用临时 H2 数据库，没有操作真实申请数据。

新增或更新的浏览器测试可从仓库根目录执行（复用本机 Playwright Core / Edge）：

```powershell
node frontend-standalone/tests/application-materials.e2e.mjs
node frontend-standalone/tests/application-review.e2e.mjs
node frontend-standalone/tests/chat-workspace.e2e.mjs
node frontend/tests/browser/applicationInteractions.e2e.mjs
```

开发分支：`feature/service-application`。2026-09-27 用户验收通过，授权关闭服务、提交本次功能并合并到 `main`；未授权推送，因此不推送远端。

验收后已停止前端、后端和 AI Service，并确认 5173、8080、8000 均无监听；MySQL80 保持运行。关闭记录：`tmp/application-shutdown.json`。

## 检查结果与复用

- 后端：Java 21 / Spring Boot 3.5.16，多模块；事项在 `campus-affair`，身份在 `campus-identity`，启动和集成测试在 `campus-app`。沿用 Controller → Service → JdbcTemplate Repository / record DTO；没有另建 JPA 实体体系。
- 当前身份：`@AuthenticationPrincipal UserPrincipal` 的 `user()` 提供 `id/role/displayName/studentNo/username`。JWT 过滤器每次请求从既有 `user_account` 读取账号，沿用 HttpOnly Cookie、可撤销会话、CSRF。
- 事项：`service_item.id` 是 BIGINT 自增，`materials` 是 JSON；`service_step` 保存步骤。沿用 `ServiceItemRepository` 及 `ServiceGuideCard.vue`，未复制事项或详情页。现有学生详情就在 AI 回答的指南卡片中。
- 附件：旧 `service_material_attachment` 保存公开事项模板，复用 `LocalFileStorage` 的 UUID 磁盘存储及 `MaterialFileValidator` 的文档签名校验；学生个人材料用独立元数据和私有目录。
- 迁移：项目没有 Flyway，采用 `spring.sql.init.schema-locations` 顺序执行可重复 SQL。旧版本 V5，本次追加 V6；没有覆盖旧 migration。
- 旧进度：`serviceProgress.ts` 使用浏览器本地存储，表示用户勾选的指南步骤。本次新增的数据库审核进度与其并存。
- 前端：Vue 3 / Vue Router / Element Plus / Axios；继续使用 `httpClient` 的 Cookie、CSRF、401/403 处理，以及原生 Element Plus 表格、分页、消息和确认框。
- AI Service：Python / FastAPI，原 RAG、Qwen、OCR、Chroma 代码未修改。申请材料不传入 AI、不加入知识库。

## 数据库

迁移：`backend/campus-app/src/main/resources/db/migration/V6__service_application.sql`。

| 表 | 用途 |
| --- | --- |
| service_application | 申请编号、事项/身份快照、归属、当前状态、学生说明、最近审核意见、时间、版本号 |
| service_application_attachment | UUID 存储键、申请关联、原始文件名、服务端确定的 MIME、大小、上传时间 |
| service_application_event | 每次状态变化、操作人 ID/姓名/角色、意见、时间；补交历史也保留 |

`application_no` 唯一，最终编号为 `CA` + 上海日期 `yyyyMMdd` + 至少 8 位数据库自增 ID，例如 `CA2026092700000001`。ID 全局递增、不按日重置，允许间断；同一事务内先分配 ID 再更新最终编号，外部不会看到临时编号。

`UNIQUE(user_id, service_item_id, active_slot)` 保证同一学生同一事项最多一个办理中申请。办理中 `active_slot=1`，拒绝或办结为 NULL；CHECK 约束绑定状态与占用标记。事项行锁与唯一约束共同防并发重复创建。审核/补交持有申请行锁并验证版本号，旧页面操作返回 409。

申请通过外键关联原 `service_item` 和 `user_account`。已有申请的事项不能硬删除，管理员收到“请改为停用”的提示。停用后不接受新申请，历史申请仍可查看和审核。

## 流程与权限

学生：登录 → AI 问答得到原办事指南 → 立即办理 → 只读姓名/学号 → 申请说明和材料 → 原子提交 → 申请详情 → 我的办事 → 查看管理员意见/时间线。

管理员：登录 → 办事申请管理 → 筛选/分页 → 查看申请、账号与附件 → 开始审核 → 补充材料/通过/不通过 → 通过后标记办结。

| 状态 | 中文 | 允许的下一步 |
| --- | --- | --- |
| SUBMITTED | 已提交 | 管理员开始审核 → REVIEWING |
| REVIEWING | 审核中 | 管理员 → NEED_MORE / APPROVED / REJECTED |
| NEED_MORE | 待补充材料 | 学生补交至少一个附件和说明 → SUBMITTED |
| APPROVED | 已通过 | 管理员标记办结 → COMPLETED |
| REJECTED | 未通过 | 本申请终止，可重新申请 |
| COMPLETED | 已办结 | 本申请终止，可重新申请 |

要求补充材料和审核不通过必须填写原因；拒绝、办结使用 Element Plus 确认框。其他审核操作可填写意见。每次变更均保留独立历史，补交不会清空旧意见。

- STUDENT：仅能创建自己的申请，列出/读取自己的申请和附件；只有 NEED_MORE 可以补交。
- ADMIN：可列出全部申请、查看详情、下载材料、按规则审核；不能创建学生申请。
- 后端请求不读取前端传来的 `userId/studentNo/role`；申请身份完全取自当前登录账号。姓名/学号保存为快照。
- 学生访问其他学生的申请/附件返回 403，不存在返回 404；非法状态、旧版本、重复申请返回 409；无身份返回 401。
- `/api/student/**` 为 STUDENT，`/api/admin/**` 为 ADMIN。前端路由守卫同时检查角色。原 AI/指南等接口仍允许 STUDENT 和 ADMIN。

## API 和页面

| API | 说明 |
| --- | --- |
| POST /api/student/applications | multipart：serviceItemId、studentRemark、可重复 files；创建和附件同事务 |
| GET /api/student/applications | 自己的申请；status/page/pageSize，默认每页 10 条 |
| GET /api/student/applications/active?serviceItemId=1 | 当前事项办理中申请，没有则 data=null |
| GET /api/student/applications/upload-config | 上传类型、大小和数量限制 |
| GET /api/student/applications/{id} | 自己的申请、附件与审核历史 |
| POST /api/student/applications/{id}/resubmit | multipart：version、studentRemark、files；补充附件并重新提交 |
| GET /api/student/applications/attachments/{id}/download | 先查附件关联申请，再检查所属用户 |
| GET /api/admin/applications | 全部申请，状态筛选和分页 |
| GET /api/admin/applications/{id} | 管理员详情 |
| PATCH /api/admin/applications/{id}/status | JSON：status、remark、version |
| GET /api/admin/applications/attachments/{id}/download | ADMIN 下载申请材料 |

学生筛选还支持 `status=ACTIVE`，包含提交、审核、待补充、已通过；两端也可以按六个精确状态筛选。

| 页面 | 路由 |
| --- | --- |
| 统一登录 | /login |
| 学生主页 | /（/student 保留跳转别名） |
| AI 问答及原办事指南 | /knowledge/search |
| 在线申请 | /student/services/:id/apply |
| 我的办事 | /student/applications |
| 学生申请详情 | /student/applications/:id |
| 管理后台 | /admin |
| 办事申请管理/详情 | /admin/applications、/admin/applications/:id |
| 原知识库/事项管理 | /admin/knowledge、/admin/services |

## 文件保存与安全

默认目录是 `backend/var/documents/applications`（启动脚本在 backend 工作目录运行）；可通过 `APPLICATION_UPLOAD_DIR` 覆盖。文件名是服务端 UUID，原始文件名只保存为元数据和下载名称。

支持 PDF、DOC、DOCX、JPG、JPEG、PNG。扩展名和 MIME 必须匹配；浏览器发 `application/octet-stream` 时仍按文件签名检查并确定服务端 MIME。复用文档头、Office ZIP 内容校验，补充 PNG/JPEG 文件头校验。拒绝路径分隔符、`..`、控制字符和非法文件名。

复用 `ADMIN_MAX_UPLOAD_SIZE_MB`，默认单文件 20 MB；每次最多 10 个，总计最多 100 MB，每份申请最多保留 50 个。已有材料不会被补交覆盖。数据库事务回滚时删除本次写入的文件。系统意外断电不属于事务回调能覆盖的场景，运行目录需正常备份。

目录不作为静态目录发布，下载只走鉴权 Controller，返回 attachment、nosniff 和 no-store。旧 `/api/files/{id}/download` 只查询模板表，不能用它读取学生申请材料。

## 自动化与真实验收（2026-09-27）

- Java：102 项全部通过，其中新增申请集成测试 19 项。真实 JWT Cookie + CSRF，覆盖要求的 14 类测试，另覆盖并发创建/审核、事务文件清理、历史快照、必填校验、迁移重复执行及关联事项删除保护。
- 前端：TypeScript/生产 build 通过，原有 26 项测试通过。保留现有 Element Plus 大 chunk 的构建提示，不影响构建成功。
- AI Service：136 项测试通过，健康检查正常；未修改 AI 源码。
- 新增 `serviceApplication.e2e.mjs`：真实 MySQL + Edge，学生 20260001 与管理员 admin，UI 登录/退出、AI 指南、立即办理、文件选择/移除/下载、重复保护、列表、刷新恢复、审核、补交、通过、二次确认办结、7 条时间线、390px 页面、403/401 全部通过。
- 原 `auth.e2e.mjs` 通过；原 `materialAttachments.e2e.mjs` 通过。
- 真实知识库文本上传、清洗、切块、向量化通过。独立图片 OCR 验收通过，云端故障时自动回退 Paddle，记录为 `qwen_to_paddle`，成功入库。
- **真实 Qwen/RAG 问答没有通过**：配置域名 `dashscope.aliyuncs.com` TLS 握手超时，返回 `LLM_REQUEST_FAILED` / 502。本机 DNS 返回 `198.18.0.96`，现有 FlClash 代理连接检查也失败。没有改动系统网络、AI 密钥或模型配置。
- `existingFeatures.e2e.mjs` 的文本上传成功，随后因上述 Qwen 连接失败中止；另行执行原脚本 OCR 部分以验证真实回退。`serviceProgress.e2e.mjs` 的完成/回退/刷新/重置/不同事项检查已执行，最后普通 QA 请求同样被外部 Qwen 502 阻断，因此不声称整套脚本通过。原前端进度单元测试均通过。
- 新建测试申请、对应附件、事件和知识库测试文档均按本次标识精确清理，截图/日志位于忽略的 `tmp/`。原事项和账号不删除，数据库自增序列不回退。

日志：`tmp/application-maven-final.log`、`tmp/application-frontend-build.log`、`tmp/application-pytest.log`、`tmp/serviceApplication-browser.log`、`tmp/auth-browser.log`、`tmp/materialAttachments-browser.log`、`tmp/application-ocr-browser.log`。截图：`tmp/application-browser/`。

## 重跑测试

先按 [启动与手动验收](service-application-startup.md) 启动服务。

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent\backend
mvn test

cd D:\AIC_ai-agent\Project\Campus-Agent\frontend
npm test
npm run build

cd D:\AIC_ai-agent\Project\Campus-Agent\ai-service
.\.venv\Scripts\python.exe -m pytest tests -q
```

本机 Maven 验收使用了已有 `tmp/maven-service-guide-settings.xml` 镜像配置：`mvn -s ../tmp/maven-service-guide-settings.xml test`。它不是业务运行必需文件；如果默认 Maven 源不可用，可继续使用本机该配置或你自己维护的 Maven settings。

浏览器测试复用已安装的 Playwright Core，默认 Edge。没有把 Playwright 加入生产依赖。设置 `STUDENT_USERNAME/STUDENT_PASSWORD/ADMIN_USERNAME/ADMIN_PASSWORD` 后，在根目录执行：

```powershell
node frontend/tests/browser/serviceApplication.e2e.mjs
```

已有本机密码加载脚本可直接调用：`./tmp/run-auth-browser.ps1 -TestName serviceApplication`。新机器使用测试账号环境变量，Playwright 不在默认路径时设置 `PLAYWRIGHT_MODULE_PATH`，MySQL CLI 不在 PATH 时设置 `MYSQL_EXECUTABLE`。浏览器测试会对本机开发库写入临时资料并按唯一测试标识清理，需要 `backend/.env` 中开发库可连接；不要对生产库运行。

## 完整文件变更清单

以下路径均相对于项目根目录。

### 修改已有文件

- `backend/.env.example`
- `backend/campus-affair/pom.xml`
- `backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/service/ServiceGuideService.java`
- `backend/campus-app/src/main/resources/application.yml`
- `backend/campus-identity/src/main/java/com/campusagent/identity/security/SecurityConfiguration.java`
- `backend/campus-shared/src/main/java/com/campusagent/shared/error/GlobalExceptionHandler.java`
- `frontend/src/app/router/index.ts`
- `frontend/src/modules/admin/AdminLayout.vue`
- `frontend/src/modules/admin/routes.ts`
- `frontend/src/modules/auth/UserMenu.vue`
- `frontend/src/modules/serviceguide/components/ServiceGuideCard.vue`

`docs/query-intent-routing.md` 是开发前已有用户修改，本次保持原样。

### 新增文件

- `backend/campus-affair/src/main/java/com/campusagent/affair/application/controller/AdminApplicationController.java`
- `backend/campus-affair/src/main/java/com/campusagent/affair/application/controller/ApplicationAttachmentController.java`
- `backend/campus-affair/src/main/java/com/campusagent/affair/application/controller/StudentApplicationController.java`
- `backend/campus-affair/src/main/java/com/campusagent/affair/application/dto/ApplicationDetail.java`
- `backend/campus-affair/src/main/java/com/campusagent/affair/application/model/ApplicationRecord.java`
- `backend/campus-affair/src/main/java/com/campusagent/affair/application/model/ApplicationStatus.java`
- `backend/campus-affair/src/main/java/com/campusagent/affair/application/repository/ApplicationAttachmentRepository.java`
- `backend/campus-affair/src/main/java/com/campusagent/affair/application/repository/ApplicationRepository.java`
- `backend/campus-affair/src/main/java/com/campusagent/affair/application/service/ApplicationAttachmentService.java`
- `backend/campus-affair/src/main/java/com/campusagent/affair/application/service/ApplicationFileValidator.java`
- `backend/campus-affair/src/main/java/com/campusagent/affair/application/service/ApplicationService.java`
- `backend/campus-app/src/main/resources/db/migration/V6__service_application.sql`
- `backend/campus-app/src/test/java/com/campusagent/app/application/ApplicationIntegrationTest.java`
- `docs/service-application-startup.md`
- `docs/service-application.md`
- `frontend/src/modules/applications/StudentApplicationLayout.vue`
- `frontend/src/modules/applications/api.ts`
- `frontend/src/modules/applications/applications.css`
- `frontend/src/modules/applications/components/ApplicationForm.vue`
- `frontend/src/modules/applications/components/ApplicationReview.vue`
- `frontend/src/modules/applications/components/ApplicationStatusTag.vue`
- `frontend/src/modules/applications/components/ApplicationTimeline.vue`
- `frontend/src/modules/applications/components/AttachmentPicker.vue`
- `frontend/src/modules/applications/pages/ApplicationCreatePage.vue`
- `frontend/src/modules/applications/pages/ApplicationDetailPage.vue`
- `frontend/src/modules/applications/pages/ApplicationListPage.vue`
- `frontend/src/modules/applications/routes.ts`
- `frontend/src/modules/applications/types.ts`
- `frontend/tests/browser/serviceApplication.e2e.mjs`
