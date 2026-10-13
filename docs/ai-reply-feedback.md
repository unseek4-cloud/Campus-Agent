# AI 回复操作栏、评价与质量分析：开发和验收说明

> 前端已于 2026-10-13 合并为唯一 Vue 版本。本文中的旧静态入口与旧 Vue 组件路径为历史记录；当前启动、源码和测试命令见 [前端说明](../frontend/README.md) 与 [迁移记录](ui-vue-migration.md)。

开发分支：`codex/ai-response-feedback`。本次同时支持 `frontend-standalone`（参考图一的界面）和 `frontend`（Vue）。评价、权限和统计均由同一 Java 后端负责；AI 服务不直接访问评价表。

## 功能和设计

- 每条已保存的 AI 回复依次显示：复制、回复评价、分享、重新生成、更多操作。线性 SVG 图标提供悬停提示、焦点样式、点击反馈和手机触摸区域。
- 评价菜单为“回复优秀”和“回复不佳”。回复优秀可再次点击取消；回复不佳打开原因多选与选填说明弹窗，再次点击可编辑已保存详情。“更多操作”可取消评价。成功后展示对应图标和选中颜色，失败保留原状态。最新启动和验收见 [反馈与个人菜单](feedback-profile-acceptance.md)。
- 每条回复单独评价；刷新、历史切换、重新登录从 MySQL 恢复。浏览器不缓存评价作为权威状态。
- 静态版复制、消息多选、图片导出和公开分享链接继续使用现有实现；Vue 版复用现有后端分享接口，分享当前问题与回复、复制链接、撤销链接，新增配套公开只读页面。
- 重新生成会在会话末尾增加一轮原问题和新回答，保留原回答及其评价。使用原问题之前的最多8条上下文，不混入后续其他问题。新请求保留 UUID 去重、会话生成锁和失败恢复机制；新记录保存原知识库 ID。升级前未保存知识库 ID 的旧回答按原有默认检索范围重新生成。
- 更多操作可查看知识来源、编辑原问题、取消评价。编辑仅填回输入框，用户修改后再发送。
- 管理员看到累计有效评价数、优秀数、不佳数和好评率，以及分布环图、按日趋势、分页记录、问题/回答/引用摘要。差评支持人工原因分类、处理状态、备注；处理操作使用版本号防止覆盖过时数据。
- 静态版沿用明暗主题；Vue 沿用 Element Plus 组件和现有后台样式。图表直接使用 SVG，无新增图表依赖。

### 统计口径

“累计评价”是当前仍有效的评价记录数，**不是提交、修改操作的历史事件数**。重复提交同一评价不增加数量，也不修改评价时间；更改类型更新 `updated_at`；取消后不再计数。好评率＝优秀数÷有效评价数×100%，无数据时界面显示 `—`。

类型、日期筛选同时作用于统计、图表和列表。日期包含开始日和结束日，按最近一次评价/修改时间计算；管理员处理备注不改评价时间。未筛选日期时统计全部有效评价、趋势展示最近30天；指定日期的趋势补零，最长366天。修改评价会移动到修改日期，本次不保留事件流水或自动判断原因。

引用是聊天中原有的 `sources_json` 快照，保留文件、页码、Chunk 标识和最多400字摘要；办事引导还显示事项和来源。管理员需结合这些证据人工核查知识库不足或检索问题。

### 接口

接口统一使用现有 `ApiResponse` 包装，业务字段位于 `data`。

| 方法和路径 | 请求/响应 |
| --- | --- |
| `PUT /api/chat/messages/{id}/feedback` | 请求 `{ "rating": "POSITIVE" }`；差评为 `{ "rating": "NEGATIVE", "reasons": ["INCORRECT"], "comment": "选填说明" }`；返回类型、修改时间、原因与说明 |
| `DELETE /api/chat/messages/{id}/feedback` | 取消当前用户评价，重复取消也成功 |
| `GET /api/chat/conversations/{id}/messages` | 原接口增加每条消息的 `feedback: {rating, updatedAt, reasons, comment}` 或 `null` |
| `POST /api/chat/messages/{id}/regenerate` | 请求 `{ "requestId": "UUID" }`；返回原 RAG 字段及新消息ID |
| `GET /api/admin/ai-quality/summary` | `rating/startDate/endDate` 可选；返回统计、授权范围和逐日趋势 |
| `GET /api/admin/ai-quality/feedback` | 同上加 `page/pageSize`，每页默认20、最多100；返回分页问题/回答/引用/处理信息 |
| `PATCH /api/admin/ai-quality/feedback/{id}` | `{issueType, handlingStatus, adminNote, version}`；仅处理范围内当前差评 |

公开分享继续使用已有的 `POST /api/chat/conversations/{id}/shares` 和 `GET /api/share/chat/{token}`。公开 DTO 不增加评价和处理备注。

## 数据库迁移和权限

后端启动沿用 Spring SQL Init 执行 `V9__reply_feedback.sql`，不引入 Flyway，不修改旧迁移，不删除既有数据。

| 表 | 用途 |
| --- | --- |
| `ai_reply_feedback` | 用户ID、消息ID、类型、创建/修改时间、人工标记、处理状态、备注、处理人和版本 |
| `ai_feedback_admin_access` | 管理员数据范围：`ALL`（全校）或 `ASSIGNED`（已授权用户） |
| `ai_feedback_admin_user_scope` | 按管理员配置可查看的用户ID |
| `ai_feedback_schema_state` | 一次性权限初始化标记，避免重启时恢复已撤销的权限 |

评价唯一键 `(user_id, message_id)`，外键关联账户和消息，数据库检查评价/分类/状态枚举。提交/取消在短事务中锁定所属会话，串行化并发写入和会话删除。同一条回复的并发重复评价只保留一行。

所有个人接口使用登录 Cookie 中认证的用户ID，拒绝评价别人的回复、USER 消息或不存在的消息；前端传 `userId` 无法越权。管理员分析接口除要求 `ADMIN` 外，还强制应用数据库中的范围。统计、趋势、列表、人工处理使用相同范围；请求中的 `scope`、`userId` 等额外参数不会扩大权限。未授权管理员返回403，范围外记录返回404，写接口继续要求 CSRF。

现有项目只有 `STUDENT` / `ADMIN`，没有学院/部门授权模型。首次 V9 执行会将**当时已存在的全校 ADMIN**授予 `ALL`，与现有全校管理员角色保持一致；后续新增管理员必须显式授予数据范围。若需要按学院授权，由 DBA 将学院内用户映射到 `ASSIGNED` 表，不以界面过滤代替后端权限。

### 配置管理员范围（MySQL 中执行）

先登录 MySQL（`mysql --user=你的数据库用户 -p campus_agent`），替换下面的账号名称。

授予全校管理员（只在该账号确实有全校权限时执行）：

```sql
INSERT INTO ai_feedback_admin_access (admin_id, access_scope)
SELECT id, 'ALL' FROM user_account WHERE username = 'admin' AND role = 'ADMIN'
ON DUPLICATE KEY UPDATE access_scope = 'ALL';
```

将指定管理员收窄为授权用户范围，并授权一个学生：

```sql
INSERT INTO ai_feedback_admin_access (admin_id, access_scope)
SELECT id, 'ASSIGNED' FROM user_account WHERE username = 'department-admin' AND role = 'ADMIN'
ON DUPLICATE KEY UPDATE access_scope = 'ASSIGNED';

INSERT IGNORE INTO ai_feedback_admin_user_scope (admin_id, user_id)
SELECT a.id, u.id FROM user_account a CROSS JOIN user_account u
WHERE a.username = 'department-admin' AND a.role = 'ADMIN' AND u.username = '20260001';
```

授权用户为空的 `ASSIGNED` 管理员看到零条数据。需要撤销授权时只删除相应权限映射，不删除聊天或评价；重启不会恢复已撤销授权。

## Windows 启动步骤

需要 Node.js 20.19+、JDK21、Maven、MySQL8、Python3.11–3.13。以下使用项目路径 `D:\AIC_ai-agent\Project\Campus-Agent`。保留现有 `.env`，不要覆盖真实密钥或数据库配置。各服务在独立终端运行。

### 1. 检查 MySQL 和环境文件

MySQL 应在3306运行。若由 Windows 服务管理，可在管理员 PowerShell 查看实际服务名后启动：

```powershell
Get-Service *mysql*
Start-Service MySQL80   # 仅服务停止时执行；以本机服务名为准
Set-Location D:\AIC_ai-agent\Project\Campus-Agent
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
if (!(Test-Path ai-service/.env)) { Copy-Item ai-service/.env.example ai-service/.env }
```

新安装时在 MySQL 创建数据库；已有数据库直接使用，不重建：

```sql
CREATE DATABASE IF NOT EXISTS campus_agent CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

编辑 `backend/.env`：

```dotenv
DB_URL=jdbc:mysql://localhost:3306/campus_agent?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true
DB_USERNAME=你的数据库账号
DB_PASSWORD=你的数据库密码
JWT_SECRET=至少32字节随机值的Base64
SERVER_PORT=8080
AI_SERVICE_BASE_URL=http://localhost:8000
AUTH_COOKIE_SECURE=false
AUTH_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:5500,http://127.0.0.1:5500
```

若 `JWT_SECRET` 还未配置，可生成后填入文件（已有值无需改变）：

```powershell
$jwtBytes = New-Object byte[] 32
$jwtRandom = [Security.Cryptography.RandomNumberGenerator]::Create()
$jwtRandom.GetBytes($jwtBytes)
[Convert]::ToBase64String($jwtBytes)
$jwtRandom.Dispose()
```

### 2. 终端一：Java 后端

```powershell
Set-Location D:\AIC_ai-agent\Project\Campus-Agent
powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1 -Build
```

脚本读取 `backend/.env`、执行 `mvn package`（含测试）并运行新 JAR；本次修改需要带 `-Build`，避免启动旧 JAR。健康检查另开终端执行：

```powershell
Invoke-RestMethod http://localhost:8080/api/v1/health
```

若要手动构建：在 `backend` 执行 `mvn package` 后，再从仓库根执行 `powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1`。直接 `java -jar` 不会自动读取 `.env`，必须自己先设置环境变量。

后端首次启动自动应用 V9。已有管理员立即拥有初始化范围；如果首次启动时还没有账号，可使用现有工具显式创建本地测试账号：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\manage-accounts.ps1 -Action Seed
```

记录工具一次性打印的密码。此时新创建的 `admin` 需要按上面的 SQL 显式授予质量分析范围；重启不会自动授权新增管理员。已有登录账号无需重新创建。

### 3. 终端二：ai-service

评价已有历史回复、恢复评价和管理员质量分析**无需** ai-service。发送 RAG 问题和重新生成 RAG 回答需要它。

```powershell
Set-Location D:\AIC_ai-agent\Project\Campus-Agent\ai-service
if (!(Test-Path .venv/Scripts/python.exe)) { py -3.12 -m venv .venv }
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

在 `ai-service/.env` 填入现有千问配置，尤其是 `AI_QWEN_API_KEY`、`AI_QWEN_BASE_URL`、`AI_QWEN_MODEL`。已有配置无需改变。健康检查：

```powershell
Invoke-RestMethod http://localhost:8000/internal/v1/health
```

需要验证真实引用时，先使用管理员上传学校资料并等待解析成功。无可用知识库证据时系统仍沿用原有兜底策略，不保证生成有内容的回复。

### 4. 终端三：前端（二选一）

**静态版，界面与参考图一相同：**

```powershell
Set-Location D:\AIC_ai-agent\Project\Campus-Agent
python -m http.server 5500 --bind 127.0.0.1 --directory frontend-standalone
```

打开 `http://127.0.0.1:5500`。不要直接双击 HTML。前后端使用同一主机名；此地址对应的后端 CORS 来源必须包含 `http://127.0.0.1:5500`。管理员导航入口为“AI 问答质量分析”，路由 `#/ai-quality`。

**Vue 版：**

```powershell
Set-Location D:\AIC_ai-agent\Project\Campus-Agent\frontend
npm ci
npm run dev -- --host 127.0.0.1
```

打开 `http://127.0.0.1:5173`，问答入口 `/knowledge/search`，管理员入口 `/admin/ai-quality`。Vite 将 `/api` 转发到8080后端。生产部署 Vue 的 `/share/<token>` 等路径需要现有 SPA 回退规则。

## 逐步手动验收

### 普通用户：操作栏、评价、历史和原功能

1. 用学生账号登录，进入智能问答，发送知识库可回答的问题。核对答案、知识引用、五个按钮顺序；逐个悬停查看提示。
2. 点复制，粘贴到文本编辑器检查回复正文；点评价，菜单出现“回复优秀 / 回复不佳”。选优秀后图标高亮。
3. 再开菜单选择不佳，应切换到不佳图标；再次选择已选不佳，应取消并恢复中性图标。再选优秀供后续验收。
4. 发送第二个问题，为第二条回复选不佳。确认第一条仍为优秀，第二条为不佳。
5. F5，确认两条回复及各自评价恢复。新建另一段对话，发送问题，再从历史列表切回第一段；确认回复和评价仍正确。退出再登录再次核对。
6. 点分享。静态版选择消息后依次试复制为图片、导出 PNG、生成分享链接；Vue 版生成当前问题与回答的公开链接。用隐私窗口打开链接，应免登录只读查看。撤销后重新打开应失效。公开页面不展示评价和管理员备注。
7. 点重新生成，应在会话末尾增加原问题和新回答；原回答及其评价保留，新回答未评价。重生成较早的回复时，应基于原问题此前的上下文；生成中按钮不可重复发送。
8. 更多→查看知识来源，应打开本条回复引用；没有引用则显示提示。更多→编辑原问题，应填回输入框，修改后可发送；更多→取消评价，应取消当前条评价。
9. 查看原有办事引导卡片、材料附件、步骤确认和进度，确认还能使用；普通政策问题继续走 RAG。
10. 切换明暗主题，在390px手机宽度下检查操作栏及菜单不越界。使用 Tab、Enter、Esc 访问操作栏；静态菜单还支持方向键。
11. 在开发者工具暂停网络，尝试修改评价，应提示失败，选中状态保持原值；恢复网络后重试成功。

### 管理员：统计、图表、筛选和处理

1. 登录具有 `ALL` 授权的管理员，打开质量分析。若测试数据库之前没有评价，步骤4后的统计应为2条、优秀1条、不佳1条、好评率50%；已有数据时检查增量，不删除历史数据来清零。
2. 核对分布图和今天的趋势点；展开“查看每日数据”检查数字。无评价时图表有清晰空态，好评率显示 `—`。
3. 点“只看差评”，列表只展示不佳；统计和图表同样按类型筛选。通过类型选择切换优秀/全部。
4. 选择开始/结束日期并查询；同一天的评价应被包含。错误的日期范围应显示错误；重置恢复默认。数据多于20条时检查分页。
5. 展开差评，核对用户问题、AI回答、文件名、页码、Chunk ID和引用摘要；办事引导回复显示事项来源。
6. 点“标记与处理”，选择“知识库内容不足”或“RAG 检索不准确”，填备注并设为处理中/已处理，保存。刷新后确认保留，评价时间不被管理员处理时间覆盖。
7. 两个窗口同时编辑同一差评：先保存一个，另一个旧版本保存应返回409并要求刷新，避免覆盖；用户将该差评改为优秀或取消后，过时处理同样不能写入。
8. 用户改评后，新评价的人工原因和状态恢复待分类/待处理；避免把旧处理结论套到新评价。

### 权限和数据库

1. 用第二个学生账号，读取/评价/取消第一位学生消息，接口应为404；尝试评价 USER 消息也为404。匿名访问需登录，写请求缺 CSRF 返回403。
2. 学生直接打开管理员页面应被路由守卫拦截；直接请求 `/api/admin/ai-quality/*` 返回403。
3. 建立 `ASSIGNED` 管理员，仅授权第一个学生。统计、图表和列表只能包括该学生；其他学生记录不可查看或处理。伪造 `scope=ALL` / `userId` 不扩大范围。
4. 无权限记录的管理员返回403。撤销权限后重启后端，权限不会被自动恢复。
5. MySQL 可用只读 SQL 核对（不包含密码或 Cookie）：

```sql
SELECT user_id, message_id, rating, updated_at, handling_status, version
FROM ai_reply_feedback ORDER BY updated_at DESC;
SELECT rating, COUNT(*) FROM ai_reply_feedback GROUP BY rating;
SELECT user_id, message_id, COUNT(*) FROM ai_reply_feedback
GROUP BY user_id, message_id HAVING COUNT(*) > 1;
```

最后一条应返回零行。取消评价只删除当前用户对应评价；不会删除问题、回答或引用。只有使用原有删除会话功能时，其关联消息、分享和评价才按外键一并清理。

## 自动化测试

```powershell
Set-Location D:\AIC_ai-agent\Project\Campus-Agent\backend
mvn test
Set-Location ..\frontend
npm run build
npm test
Set-Location ..\ai-service
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

新增 `ReplyFeedbackIntegrationTest` 的8个场景测试持久化/修改/取消/恢复、并发唯一性、CSRF、用户和管理员越权、统计/趋势/筛选/分页、人工处理版本冲突、权限撤销后的重复迁移、重生成原上下文/知识库、分享不泄露评价。

完整浏览器验收使用**真实 Java + MySQL + 两套前端**，模型端采用独立 HTTP 测试服务，不使用真实密钥、不消费模型额度。脚本创建 `campus_feedback_test_<时间戳>` 数据库，结束时只清理该临时库；不写项目原有数据库。需要本地 MySQL账号有 CREATE/DROP DATABASE 权限，已构建 JAR，以及 Edge/Playwright：

```powershell
Set-Location D:\AIC_ai-agent\Project\Campus-Agent
# 如尚未安装测试浏览器依赖：
npm install --prefix tmp/browser-check --no-save playwright-core
node scripts/test-reply-feedback-live.mjs
node frontend-standalone/tests/chat-workspace.e2e.mjs
```

可通过 `PLAYWRIGHT_MODULE_PATH` 指定 playwright-core/index.mjs，通过 `BROWSER_EXECUTABLE` 指定浏览器，通过 `MYSQL_BINARY` 指定 mysql.exe。测试读取 `backend/.env` 的数据库连接信息，也允许用 `DB_URL/DB_USERNAME/DB_PASSWORD` 环境变量覆盖；不打印凭据。测试端口：18080、18000、15500、15173，须空闲。截图和后端日志在 `tmp/feedback-browser/`。

### 本次验收结果

- `mvn -o test`：122项通过（其中新增评价集成测试8项）。
- `npm run build`：Vue类型检查和构建通过；保留项目现有大包提示。
- `npm test`：32项通过。
- ai-service：136项通过，保留现有依赖弃用提示。
- 静态版既有聊天/引导/分享浏览器回归：54项检查通过。
- 新功能真实 MySQL 和双前端浏览器验收：完整流程和29项断言通过，验证评价提交/修改/取消/失败回退/刷新恢复/历史切换、五个操作、公开分享与撤销、重生成、管理员统计/图表/筛选/人工处理、用户/管理员授权隔离、明暗主题和390px手机布局；无浏览器运行错误。临时测试数据库和服务已清理。

自动测试没有衡量真实千问答案的语义质量；连接现有知识库和千问后，应按上面的问题/引用/办事引导步骤人工复核。

## 修改文件

| 模块 | 文件和职责 |
| --- | --- |
| Java反馈 | `backend/campus-ai-integration/.../feedback/FeedbackTypes.java`、`FeedbackService.java`、`FeedbackController.java`：DTO、持久化、统计、权限和处理接口 |
| Java聊天 | `.../history/ChatHistoryTypes.java`、`ChatHistoryRepository.java`、`ChatHistoryService.java`、`RegenerateController.java`：历史评价恢复与重生成 |
| 数据库 | `backend/campus-app/src/main/resources/db/migration/V9__reply_feedback.sql`、`application.yml`：增量表和启动迁移注册 |
| Java测试 | `ReplyFeedbackIntegrationTest.java`；现有 `ChatHistoryIntegrationTest.java`、`ChatShareIntegrationTest.java` 添加 V9 测试迁移 |
| 静态前端 | `frontend-standalone/reply-feedback.js`、`reply-feedback.css`、`ai-quality.js`；`app.js` 接入回复操作/恢复/重生成/后台路由，`index.html` 添加资源和入口 |
| Vue回复 | `frontend/src/modules/knowledge/feedback/api.ts`、`ReplyIcon.vue`、`ReplyActions.vue`；`history/api.ts`、`useChatHistory.ts`、`KnowledgeSearchPage.vue` 接入评价和操作 |
| Vue公开分享 | `SharedConversationPage.vue`、`frontend/src/app/router/index.ts`：复用公开后端接口的只读页面和路由 |
| Vue管理 | `frontend/src/modules/admin/quality/api.ts`、`QualityCharts.vue`、`pages/AIQualityPage.vue`；`AdminLayout.vue`、`routes.ts` 添加入口 |
| 验收与文档 | `scripts/test-reply-feedback-live.mjs`、`frontend/tests/queryIntentRendering.test.mjs`、本说明、`README.md` |

本次不修改 Python业务代码、知识库检索算法、事项管理或原有数据。评价和质量分析不会调用大模型。
