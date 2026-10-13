# CampusAgent 启动与手工验收

本文是当前版本的统一启动入口。先准备 MySQL 和本地配置，再在三个独立终端启动 Java、Python 和 Vue。命令默认从仓库根目录开始；项目所在磁盘路径可自行选择，不依赖开发者的 tmp 文件、现有进程或旧打包结果。

## 环境准备

需要 Node（package.json 声明 >=20.19.0）、npm、JDK 21、Maven、MySQL 8、Python 3.12。检查工具是否可调用：

```powershell
node --version
npm --version
java -version
mvn -version
py -3.12 --version
mysql --version
```

这里采用 PowerShell；Python 在其他平台的依赖兼容性和部署步骤本次未验证。Windows 的 MySQL 服务名取决于安装方式，不保证是 MySQL80：

```powershell
Get-Service *mysql*
Test-NetConnection 127.0.0.1 -Port 3306
```

服务未启动时用查到的实际服务名启动。数据库端口、库名和账号与 backend/.env 一致；3306 和 campus_agent 是默认值，MySQL 密码与网页账号密码不同。

## 创建数据库与配置

在 MySQL 客户端或 Workbench 中，只对全新环境执行建库：

```sql
CREATE DATABASE IF NOT EXISTS campus_agent CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

数据库连接账号需能在该库建表并读写；本项目不自动创建数据库用户。已有库不要删除重建。

仓库根目录复制缺失的配置文件：

```powershell
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
if (!(Test-Path ai-service/.env)) { Copy-Item ai-service/.env.example ai-service/.env }
```

编辑 backend/.env，填入实际 DB_URL、DB_USERNAME、DB_PASSWORD，以及必需的 JWT_SECRET。模板中的 replace-me 只是占位值。保留已有有效配置。生成 JWT 密钥的命令兼容 Windows PowerShell：

```powershell
$campusJwtBytes = New-Object byte[] 32
$campusJwtRandom = [Security.Cryptography.RandomNumberGenerator]::Create()
$campusJwtRandom.GetBytes($campusJwtBytes)
[Convert]::ToBase64String($campusJwtBytes)
$campusJwtRandom.Dispose()
```

将输出填到 JWT_SECRET，一次生成后保存，不要每次启动更换。完整变量与默认值见 [后端说明](../backend/README.md#运行配置)。本地 HTTP 使用 AUTH_COOKIE_SECURE=false；生产 HTTPS 设 true。

ai-service/.env 中配置 AI_QWEN_API_KEY、AI_QWEN_BASE_URL、AI_QWEN_MODEL。普通检索不需聊天 Key，但有证据的生成需要。云 OCR 使用独立的 OCR 模型与 /responses 接口，可复用聊天 Key，endpoint 可用性须按实际账号确认。详见 [AI 服务](../ai-service/README.md)。

## 旧库升级检查

新库由 schema.sql 和 V3–V12 启动建表；当前不是 Flyway 迁移。V2 未注册为自动启动 SQL，只用于很早的 knowledge_document 旧表。

先在实际数据库执行：

```sql
SHOW COLUMNS FROM knowledge_document;
```

表不存在时交给新库启动初始化。已存在时核对 parse_status、progress、total_pages、processed_pages、ocr_provider：全部存在则不要执行 V2；全部缺失时，在备份并确认当前旧表结构后显式执行 [V2 文件](../backend/campus-app/src/main/resources/db/migration/V2__document_ocr_progress.sql)。部分字段已存在的库需按实际差异人工升级，不能重复运行含 ADD COLUMN 的完整脚本。

V3–V12 是当前初始化列表中的可重复建表 SQL；这不代表任意历史结构都会自动修正。完整表设计见 [数据库说明](../backend/README.md#数据库设计与升级)。

## 终端一 Java 后端

从仓库根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1 -Build
```

脚本读取 backend/.env，进入 backend，执行 mvn package（含测试）并运行 campus-app/target/campus-app-0.1.0-SNAPSHOT.jar。后端默认 8080。日常启动可省略 -Build；代码更新后需要重建。Windows 先停止旧后端再打包，避免同一 JAR 被占用。

直接在 backend 运行 mvn package、java -jar 也可，但需自行加载进程环境，不能依赖 .env 自动读取。Maven 镜像与缓存使用自己可用的设置，不要求存在旧 tmp/maven-service-guide-settings.xml。

另开终端检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/v1/health
```

预期 data.status=UP；这不检查 Python、模型或向量库。

## 首次创建应用账号和示例

后端完成建表后，另一个终端从仓库根运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\manage-accounts.ps1 -Action Seed
```

只创建缺失的 admin、20260001、20260002，终端一次性输出随机密码，已有账号会跳过。本项目没有通用默认密码，也不会自动生成凭据文件。忘记密码时按 [账号说明](auth-rbac.md) 生成 BCrypt 并更新 SQL。

新的 admin 不会因重启自动获得 AI 质量分析权限，需按 [反馈授权](ai-reply-feedback.md#管理员数据范围) 执行 SQL。申请审核和知识管理只需 ADMIN 角色。

办事事项可以在界面创建。需要五项演示流程时，显式导入 [service_guide_examples.sql](../backend/campus-app/src/main/resources/db/seed/service_guide_examples.sql)，不会随启动自动导入。它们均为测试数据，不是学校政策；ID 由数据库生成，不能把某一台机器的 ID=1 作为所有环境的固定值。

## 终端二 Python AI 服务

从仓库根目录开始：

```powershell
Set-Location ai-service
if (!(Test-Path .venv/Scripts/python.exe)) { py -3.12 -m venv .venv }
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

已经安装完整依赖可省略 pip。无需激活脚本；main.py 读取当前目录的 .env。保留一个 worker。首次实际处理、查询或本地 OCR 才加载模型；模型缓存不存在时不要设置 HF_HUB_OFFLINE/TRANSFORMERS_OFFLINE 来阻断首次下载。

```powershell
Invoke-RestMethod http://127.0.0.1:8000/internal/v1/health
```

健康预期 UP，开发接口文档在 http://127.0.0.1:8000/docs。是否能够真实回答还取决于模型准备、索引、Key 和网络。

## 终端三 Vue 前端

从仓库根目录开始：

```powershell
Set-Location frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

打开 `http://127.0.0.1:5173/`，未登录时在该页面显示登录表单。学生进入 `/#/qa`，管理员进入 `/#/dashboard`。当前不是 /login、/admin、/knowledge/search 等旧路由。

前端 /api 经 Vite 代理到 127.0.0.1:8080，源码只使用 VITE_API_BASE，默认同源。始终使用同一主机名，localhost 和 127.0.0.1 的 Cookie 与准备清单互不共享。页面表单、申请详情和审核弹窗没有独立 apply/detail 路由。

## 按流程手工验收

这些是预期步骤，本次文档更新没有操作真实数据库、上传资料或调用云模型。

1. 分别登录学生和管理员，刷新确认身份恢复。学生访问管理员页面应回到可用主页并提示无权限；直接请求管理员 API 应返回 403。匿名请求受保护接口返回 401。
2. 管理员进入 `/#/policy-mgr`，上传一份独立验收资料，等待 SUCCESS，核对处理阶段和片段数。重名内容去重、重命名、重新解析和删除按 [政策进度](policy-upload-progress.md) 检查。页面目前最多载入前 100 份文档，筛选不能当成全库分页查询。
3. 学生进入 `/#/qa`，问资料中明确可回答的事实，核对来源和原文件页码。继续追问“对象是谁”，查看本轮检索信息。未知问题是否拒答需根据语料确认；不能假设任意未知表达必然被阈值挡住。
4. 新建两段会话，检查返回页面、F5、切换、删除确认及两个用户隔离。主动退出再提交学生登录表单会先进入空白新对话，旧记录仍可从最近对话打开。
5. 管理员进入 `/#/services-mgr` 创建/启用测试事项，设置条件、材料、识别词与步骤。学生问明确流程，核对卡片、材料模板、逐步确认和账号隔离。步骤勾选不代表审批。
6. 学生从卡片点立即办理，或在 `/#/my-applications` 新建申请。逐项上传必交材料，填写说明，确认创建、重复在办保护和要求快照。
7. 管理员在 `/#/review` 打开申请，选择审核阶段，提交结果。要求补交/驳回必须有原因；学生补交至少一个附件和说明后回到 SUBMITTED。再通过并办结，核对全部事件。详见 [申请状态机](service-application.md#状态与并发)。
8. 申请页面附件按钮当前使用模板下载路径，预期可能 404；后端私有下载 API 已实现，正确路径见 [申请说明](service-application.md#附件与已知页面问题)。验收必须记录这一限制，不能把按钮存在视为下载正常。
9. 问答评价、刷新恢复、原因编辑、重新生成、公开分享/撤销及管理员质量分析按 [反馈说明](ai-reply-feedback.md) 检查。生成分享后再发送消息，旧链接应保持原范围。
10. 需要检查 AI 离线降级时只停止本次 AI 进程，再问明确能规则匹配的流程。数据库卡片可继续返回；普通 QA 会报 AI 不可用，模糊识别不保证返回指南。结束后恢复服务。

数据库只读核查可用：

```sql
SELECT id, display_name, status, parse_status, progress, chunk_count FROM knowledge_document;
SELECT user_id, service_item_id, COUNT(*) AS n FROM service_application
WHERE active_slot=1 GROUP BY user_id,service_item_id HAVING COUNT(*)>1;
SELECT id,application_no,status,version FROM service_application ORDER BY id DESC LIMIT 20;
SELECT application_id,from_status,to_status,actor_name,remark FROM service_application_event ORDER BY id;
```

## 停止、排查与重跑

手动启动的三个终端用 Ctrl+C 停止各自服务。start.ps1 启动的后台服务需另外管理，按 Enter 只停止前端。端口占用先核对已有实例，避免重复启动。

数据库失败先检查真实连接和权限；JWT_SECRET 无效会阻止 Java 启动；Python 依赖/本地模型异常与 Qwen 上游超时要分别排查；重排禁用会返回 RERANK_UNAVAILABLE，不应误写为知识库缺失。完整错误含义见 [AI README](../ai-service/README.md)。

测试命令见 [总览](../README.md#验证)。本次结果与待确认项统一在 [文档索引](README.md#文档检查与待确认项)，真实部署、学校资料、模型质量及性能需要单独补充。
