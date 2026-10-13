# CampusAgent 统一登录与账号管理

本文对应 `feature/auth-rbac`。账号来自 MySQL，不开放注册，不需要为每个新账号修改 Java 代码。

## 实现与原系统衔接

原系统在 `campus-identity` 用环境变量 + HTTP Basic 验证管理员，没有用户表。本次继续使用该模块和 Spring Security，移除旧 `AdminSecurityConfiguration`、`AdminSessionController` 和 `AdminAccessGate.vue`，不保留第二套认证。

- Java 21 / Spring Boot 3.5.16；Vue 3 / Vue Router / Element Plus，沿用 Axios 唯一客户端。
- 学生主页仍为 `/`，问答仍为 `/knowledge/search`；`/student` 是原主页别名。
- 管理员主页仍为 `/admin`，知识库 `/admin/knowledge`，事项管理 `/admin/services`。
- 统一登录页 `/login`；没有身份选择框。角色只由数据库决定。
- V5 SQL 随 `spring.sql.init.schema-locations` 自动执行，沿用既有机制，不引入 Flyway/Liquibase。
- V5 用 `CREATE TABLE IF NOT EXISTS`，可重复启动；不修改旧业务表和材料下载业务。
- 实际本机数据库在升级前只有 `knowledge_document`、`service_item`、`service_step`、`service_material_attachment`。

## 数据库新增内容

`user_account`：

| 字段 | 用途 |
| --- | --- |
| id | 自增主键，插入账号时不用填 |
| username | 唯一登录账号，最长 80 字符；学生建议与学号相同 |
| password_hash | BCrypt 哈希，固定 60 字符；绝不是明文密码 |
| display_name | 页面显示姓名，最长 120 字符 |
| role | 只能是 `STUDENT` 或 `ADMIN` |
| student_no | 唯一学号，最长 40 字符；管理员用 SQL `NULL` |
| status | `ACTIVE` 正常、`DISABLED` 禁用 |
| created_at / updated_at | MySQL 自动维护创建、修改时间 |

`username` 和非空 `student_no` 各有 UNIQUE 约束；密码列有 BCrypt 长度/前缀检查，角色/状态有 CHECK 约束。使用 MySQL 8.0.16+。数据库沿用项目现有字符集和排序规则；当前本机为 `utf8mb4_unicode_ci`，账号比较不区分大小写。

`user_login_session`：每次登录记录 UUID、用户 ID、已加盐 BCrypt 值的指纹、过期时间、创建时间。它不保存明文密码或完整 JWT；用于单次退出撤销、密码重置失效。删除账号会级联删除会话。登录时清理过期会话。

## 登录与权限流程

1. 页面启动时 `GET /api/auth/me` 恢复用户；无登录返回 401，路由进入 `/login`。
2. 首次有写操作前，Axios 请求 `GET /api/auth/csrf`，获得 CSRF header/token 并保留 Cookie。
3. `POST /api/auth/login` 提交 `{ "username": "...", "password": "..." }`。
4. 参数化 SQL 查询账号，`BCryptPasswordEncoder` 校验密码。错误账号与错误密码统一返回“账号或密码错误”。只有密码正确后才提示账号禁用。
5. 后端生成 HS256 JWT，保存可撤销会话，设置 `CAMPUS_AUTH` Cookie。
6. 根据返回的数据库角色，STUDENT 进入 `/`，ADMIN 进入 `/admin`。
7. 每次业务请求校验签名/有效期/会话记录，并重读账号的状态、密码指纹和角色。前端伪造 role 不影响权限。
8. 退出调用 `POST /api/auth/logout`，删除当前会话并清除 Cookie；旧 Cookie 重放也不能再访问。

所有 JSON API 沿用现有包装 `code/message/data/requestId/timestamp`。登录成功的 `data` 是 `{ "success": true, "user": { "id": 1, "username": "admin", "displayName": "系统管理员", "role": "ADMIN", "studentNo": null } }`；`me` 的 `data` 直接是 user。不会返回 password、passwordHash 或 JWT。

| 接口 | 权限 |
| --- | --- |
| GET `/api/v1/health` | 公开健康检查 |
| GET `/api/auth/csrf` | 公开，取得 CSRF 校验信息 |
| POST `/api/auth/login`、`/api/auth/logout` | 不要求已有身份，但要求 CSRF |
| GET `/api/auth/me` | 登录后 |
| `/api/admin/**`，含知识库、OCR 任务进度、事项、材料上传/删除和草稿附件下载 | 仅 ADMIN |
| `/api/rag/chat`、`/api/knowledge/search`、`/api/services/**`、`/api/files/**` | STUDENT 或 ADMIN |
| 其他 `/api/**` | 默认要求 STUDENT/ADMIN，不意外公开新接口 |
| 非 API 路径 | Java 后端默认拒绝；前端静态资源由 Vite/生产 Web 服务器提供 |

学生下载已发布事项申请表仍使用原 `/api/files/{id}/download`。未发布事项的附件仍走管理员路径。Java → Python 的 `/internal/v1/**` 调用不携带浏览器登录凭据，不受 Java 的入站权限拦截；Python 应只在本机/内部网络监听。当前 Java 没有 Swagger 依赖或接口，不额外公开不存在的文档路径。

认证 Cookie 为 `HttpOnly=true; SameSite=Lax; Path=/api`，默认 120 分钟。JWT 密钥从环境变量读取，没有源码默认值，缺少有效密钥会拒绝启动。前端只保存内存中的用户资料，不把 JWT 或密码放在 localStorage。CSRF Cookie 同样 HttpOnly，前端通过专用 API 获取经过 Spring Security 处理的校验值。401 回登录，403 显示无权限提示。相关机制参考 [Spring Security CSRF 文档](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html)。

## 启动准备（Windows PowerShell）

以下命令的项目目录为 `D:\AIC_ai-agent\Project\Campus-Agent`，请换成你自己的目录。

1. 启动 MySQL。在管理员 PowerShell 中执行（已有服务运行则不用重复）：

```powershell
Get-Service *mysql*
Start-Service MySQL80
```

如果服务不叫 `MySQL80`，使用上一条显示的服务名。MySQL Workbench 也可以执行本文 SQL。

2. 新数据库才需要创建库；已有 `campus_agent` 不删除、不重建。用有建库权限的 MySQL 用户连接：

```powershell
mysql -h localhost -P 3306 -u root -p --default-character-set=utf8mb4
```

按提示输入 MySQL 密码（不是 CampusAgent 密码），在 `mysql>` 执行：

```sql
CREATE DATABASE IF NOT EXISTS campus_agent CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE campus_agent;
```

数据库应用用户须有当前项目启动建表和读写权限。继续使用已有 `backend/.env` 中的 `DB_USERNAME/DB_PASSWORD`。若是全新机器，可由数据库管理员创建单独应用用户并授权该库；不要把数据库 root 当成 CampusAgent 的管理员账号。

3. 在普通 PowerShell 中检查环境配置，已有 `.env` 不覆盖：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
notepad backend/.env
```

填写 `DB_URL`、`DB_USERNAME`、`DB_PASSWORD`。在 PowerShell 7 中生成随机 JWT 密钥：

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

复制输出到 `.env` 的 `JWT_SECRET=` 后，只生成一次并保存，不要每次启动重新生成。示意配置：

```dotenv
JWT_SECRET=粘贴刚才生成的Base64值
JWT_EXPIRE_MINUTES=120
AUTH_COOKIE_SECURE=false
AUTH_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

`.env` 已被 Git 忽略。此机器本次开发已补好本地 JWT 配置，无须重新生成。旧 `ADMIN_USERNAME/ADMIN_PASSWORD` 已不再是应用身份来源，可从旧 `.env` 删除；只有测试脚本仍用同名进程变量传入数据库账号。

生产部署使用 HTTPS，设置 `AUTH_COOKIE_SECURE=true`，`AUTH_ALLOWED_ORIGINS` 填实际前端来源（含协议和端口，不带路径），不使用 `*`。推荐前端和 `/api` 同源反向代理；SameSite=Lax 不支持任意跨站前后端域名组合。生产 Web 服务器需要把前端路由回退到 `index.html`。前端继续 `VITE_API_BASE_URL=/api`。

4. 启动后端（Java 21 和 Maven 需在 PATH 中）：

```powershell
.\scripts\start-backend.ps1 -Build
```

脚本读取 `backend/.env`，运行测试/打包并启动。看到 `Tomcat started on port 8080` 表示已启动。V5 此时自动创建两张新表，新库和旧库相同。不需要另起迁移工具。也可在 MySQL 中显式执行 `SOURCE D:/AIC_ai-agent/Project/Campus-Agent/backend/campus-app/src/main/resources/db/migration/V5__auth_rbac.sql;`，然后启动应用。Windows 下重建前先在旧后端终端按 Ctrl+C，否则运行中的 JAR 会被占用。

5. 打开另一个 PowerShell，为本地开发创建 3 个测试账号：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent
.\scripts\manage-accounts.ps1 -Action Seed
```

工具会输出每个新账号的独立随机密码：`admin`（系统管理员）、`20260001`（张三）、`20260002`（李四）。请当场保存；数据库只保存 BCrypt。再次执行会跳过已有账号，不重置密码。此命令仅供本地显式初始化，不在启动流程自动运行；上线前删除测试账号或修改其密码。

本机这次生成的密码保存在被 Git 忽略的 `tmp/auth-test-accounts.txt`，也会在开发交付说明中给出，不进入正式源码或本文。

6. 第三个 PowerShell 启动 AI 服务（已有依赖和 `.env` 继续复用）：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent\ai-service
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

首次安装按 `ai-service/README.md` 创建虚拟环境、安装 `requirements.txt`，并配置已有 AI 提供商密钥。无需修改 RAG/OCR 配置。

7. 第四个 PowerShell 启动前端：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent\frontend
npm ci
npm run dev
```

已有 `node_modules` 可跳过 `npm ci`。打开 **http://localhost:5173/login**。开发时固定使用同一个主机名，不要在 localhost 与 127.0.0.1 间来回切换 Cookie。

## 如何向 CampusAgent 添加新用户

所有 SQL 都在 `mysql>` 或 Workbench SQL 编辑器中执行；PowerShell 命令不放到 SQL 编辑器。添加、启用、禁用和重置都不需要重启 Java。

### A. 生成 BCrypt 密码

先完成一次后端构建。项目根目录执行：

```powershell
.\scripts\manage-accounts.ps1 -Action Hash
```

在 `Password (hidden):` 后输入密码并回车，输入不会回显。该工具直接运行 Java main，没有 Web 服务、没有 `/generate-password` API，也不连接数据库。

仅用于演示 `123456` 时，也可以直接：

```powershell
'123456' | .\scripts\manage-accounts.ps1 -Action Hash
```

输出例如本次实际生成的：

```text
$2a$10$YoKKLheITAEm9/cCer48l.JS7bH/Nhf1lfkq2ZWtuYBMZmOBHXViK
```

该完整哈希对应 `123456`。BCrypt 每次有随机盐，相同密码每次得到不同输出是正常的；它们都能通过同一个原密码校验。密码上限为 72 个 UTF-8 字节。真实密码建议使用不回显的交互方式，避免把真实密码留在 PowerShell 历史记录。`123456` 仅供下面教学验证，正式账号请换成强密码。

如果你不用 PowerShell 脚本，也可以在 backend 目录直接启动工具：

```powershell
java '-Dloader.main=com.campusagent.identity.tools.PasswordHashTool' -cp campus-app/target/campus-app-0.1.0-SNAPSHOT.jar org.springframework.boot.loader.launch.PropertiesLauncher
```

### B. 用 MySQL 新增学生：20260003 / 王五

连接数据库：

```powershell
mysql -h localhost -P 3306 -u campus_agent -p --default-character-set=utf8mb4 campus_agent
```

`campus_agent` 用户名须与自己的 `DB_USERNAME` 对应。输入的是数据库密码。执行以下 SQL 可创建密码为 `123456` 的教学账号；或把哈希替换成 A 步骤实际生成的完整内容：

```sql
USE campus_agent;
INSERT INTO user_account (
    username, password_hash, display_name, role, student_no, status
) VALUES (
    '20260003',
    '$2a$10$YoKKLheITAEm9/cCer48l.JS7bH/Nhf1lfkq2ZWtuYBMZmOBHXViK',
    '王五', 'STUDENT', '20260003', 'ACTIVE'
);
```

插入成功后立即可以用 `20260003 / 123456` 登录，无需改代码、无需重新编译。如果提示 duplicate entry，先用 D 查询账号/学号是否已存在，不要删掉未知账号来绕过唯一约束。

### C. 用 MySQL 新增管理员：admin2 / 管理员2

同样先用 A 生成密码哈希。教学密码 `123456` 的可执行 SQL：

```sql
INSERT INTO user_account (
    username, password_hash, display_name, role, student_no, status
) VALUES (
    'admin2',
    '$2a$10$YoKKLheITAEm9/cCer48l.JS7bH/Nhf1lfkq2ZWtuYBMZmOBHXViK',
    '管理员2', 'ADMIN', NULL, 'ACTIVE'
);
```

`NULL` 不加引号，表示没有学号；`'NULL'` 则是错误的字面学号。管理员和学生使用同一登录页，角色由该行的 `role` 决定。

### D. 查看账号（不输出密码哈希）

```sql
SELECT id, username, display_name, role, student_no, status, created_at, updated_at
FROM user_account ORDER BY id;

SELECT id, username, display_name, role, student_no, status, created_at
FROM user_account WHERE username = '20260003';
```

日常管理不要用 `SELECT *`；不需要展示或复制 password_hash。

### E. 禁用账号

```sql
UPDATE user_account SET status = 'DISABLED' WHERE username = '20260001';
```

密码正确也不能登录。已登录请求在下次到达后端时也会被拒绝。如需一并永久撤销该用户当前所有登录（推荐），再执行：

```sql
DELETE FROM user_login_session
WHERE user_id = (SELECT id FROM user_account WHERE username = '20260001');
```

### F. 重新启用账号

```sql
UPDATE user_account SET status = 'ACTIVE' WHERE username = '20260001';
```

用户重新登录即可。如果只做了 E 的状态变更而没有删除会话，重新启用时尚未过期的旧会话可能仍有效；需要强制重新登录时使用 E 中的会话删除语句。

### G. 重置密码

1. 执行 A 的工具，输入新的密码，复制整行 BCrypt 哈希。
2. 把 SQL 中哈希替换成新输出，按 username 精确更新。
3. 用户使用新密码重新登录；旧 Cookie 的密码指纹不再匹配，会立即失效。

教学示例：把 `20260001` 的密码重置为 `123456`：

```sql
UPDATE user_account
SET password_hash = '$2a$10$YoKKLheITAEm9/cCer48l.JS7bH/Nhf1lfkq2ZWtuYBMZmOBHXViK'
WHERE username = '20260001';

-- 可同时清理已失效会话记录：
DELETE FROM user_login_session
WHERE user_id = (SELECT id FROM user_account WHERE username = '20260001');
```

不执行 `password_hash='123456'`；数据库约束也会拒绝这类明文写入。密码重置不自动启用禁用账号，必要时另执行 F。

### H. 删除确实不再需要的测试账号

先查看将删除的对象，确认不会删除正在使用的正式账号；至少保留一个有效管理员：

```sql
SELECT id, username, display_name, role, status
FROM user_account WHERE username IN ('20260003', 'admin2');

START TRANSACTION;
DELETE FROM user_account WHERE username IN ('20260003', 'admin2');
SELECT ROW_COUNT() AS deleted_count;
-- 确認符合预期才执行 COMMIT；否则执行 ROLLBACK。
COMMIT;
```

删除会级联清除这些账号的登录会话。建议日常停用使用 DISABLED，真正删除只用于明确的测试数据清理。

### I. 复用 SQL 模板文件

`backend/campus-app/src/main/resources/db/seed/account_templates.sql` 包含上述教学插入和管理 SQL，不会被启动流程自动加载。先替换哈希、账号和姓名，再选中所需语句执行；不要把整个管理模板无区别地批量运行。

## 登录系统手动验收步骤

先按“启动准备”启动 MySQL → 后端（自动迁移）→ Seed → AI 服务 → 前端。保留 MySQL 客户端和浏览器开发者工具（F12 → Network）。

| 顺序 | 操作 | 应看到的结果 |
| --- | --- | --- |
| 1 | 在无痕窗口打开 `/admin` | 自动进入 `/login` |
| 2 | admin + Seed 显示的密码登录 | 进入 `/admin`，右上角系统管理员/管理员 |
| 3 | 刷新页面 | 仍在管理员页，Network 中 `/api/auth/me` 200 |
| 4 | 查看知识库列表、事项列表，打开已有编辑弹窗 | 功能正常，没有 401/403 |
| 5 | 上传临时知识文档，等待解析，查看进度与详情 | 上传 200、OCR/解析进度可访问，原业务流程正常 |
| 6 | 给测试事项的材料上传“学生证补办申请表.docx” | 上传成功，管理员可下载 |
| 7 | 退出，输入 admin + 错误密码 | 页面内显示“账号或密码错误”，不是 alert |
| 8 | 用 20260001 + Seed 密码登录 | 进入 `/`，右上角张三/20260001 |
| 9 | 刷新，再访问 `/admin` | 刷新保留身份；管理员路径进入无权限页 |
| 10 | 学生在地址栏打开 `http://localhost:5173/api/admin/services` | JSON 错误，Network HTTP 403 |
| 11 | 另一个未登录无痕窗口打开同一 API 地址 | HTTP 401 |
| 12 | 学生点开始提问，分别问政策问题和“学生证丢了怎么补办？” | 问答和指南均可访问，意图路由正常 |
| 13 | 在已发布测试事项里勾选材料，下载申请表 | 中文文件名正确、文件可打开、勾选不受下载影响 |
| 14 | 点击退出后按浏览器返回，或重新打开 `/student` | 回到登录页；受保护 API 401 |
| 15 | MySQL 执行 E 禁用 20260001；尝试正确密码登录 | 显示“该账号已被禁用，请联系管理员。” |
| 16 | 执行 F 启用 | 可以重新登录 |
| 17 | 执行 B 插入 20260003，不改代码不重启 | 用 20260003 / 123456 直接登录 |
| 18 | 执行 C 插入 admin2 | 使用统一入口进入管理员端 |
| 19 | 执行 G 重置测试用户密码 | 旧密码失效、新密码有效，旧会话也失效 |
| 20 | 在 Application → Cookies 查看 | CAMPUS_AUTH 标记 HttpOnly、SameSite=Lax；生产必须 Secure |

完成后清理你创建的临时事项/文档以及 20260003、admin2，或将其密码换成强密码。不要删除原有业务资料。浏览器旧会话过期、数据库禁用、删除账号均由后端执行权限判断。

## 自动化检查

本次实际验收（2026-09-24）：后端 83 项测试、前端 26 项测试、TypeScript 检查与 Vite 生产构建全部通过。前端仍有原有 Element Plus 主包体积提示，不影响构建。

- 真实 MySQL + Edge：统一入口、管理员/学生分流、错误密码、路由与 API 越权、刷新、退出后返回、复制 Cookie 重放、桌面/手机页面均通过。
- 真实 MySQL SQL：禁用/启用 20260001；直接插入 20260003 后无重启登录；用实际 BCrypt 工具重置密码并使旧 Cookie 失效，均通过。临时 20260003 已删除。
- 原材料附件浏览器回归通过：上传/下载、中文与空格文件名、下载字节一致性、材料勾选保持、替换、删除、失效链接提示、手机布局、学生权限。
- 真实知识库浏览器回归通过：文本上传入库、检索/重排、千问回答包含刚上传的证据、图片 Qwen OCR 及向量化；临时资料已清理。
- CSRF 专项增加连续读取后重复写入测试，登录/退出才轮换校验 Cookie。API 客户端在成功登录后需重新 GET `/api/auth/csrf`，再用于后续写操作；前端会自动完成。

本机测试密码只在 `tmp/auth-test-accounts.txt` 中，不属于 Git 文件。保留三个 ACTIVE 初始账号，原有业务资料未删除。

```powershell
cd backend
mvn package
cd ../frontend
npm test
npm run build
```

后端认证测试使用独立 H2 MySQL 模式和真实 Spring Security 过滤链，真实 CSRF/Cookie/JWT 登录；不会连接或清空本机业务 MySQL。原附件测试继续覆盖 6 种格式、中文文件名、字节一致性、替换删除、草稿权限和回滚。

浏览器验收使用真实后端/MySQL，需先启动三个服务、初始化账号，并准备 Playwright（可沿用已有 `tmp/browser-check/node_modules/playwright-core`，或用 `PLAYWRIGHT_MODULE_PATH` 指向已安装的 `index.mjs`）。测试变量不是服务器认证配置：

```powershell
$env:CAMPUS_BASE_URL='http://127.0.0.1:5173'
$env:ADMIN_USERNAME='admin'
$env:ADMIN_PASSWORD='填本地Seed密码'
$env:STUDENT_USERNAME='20260001'
$env:STUDENT_PASSWORD='填本地Seed密码'
node frontend/tests/browser/auth.e2e.mjs
python scripts/create-material-test-fixtures.py
node frontend/tests/browser/materialAttachments.e2e.mjs
node frontend/tests/browser/existingFeatures.e2e.mjs
```

`auth.e2e.mjs` 截图输出 `tmp/auth-browser/`。附件测试仅创建/删除独立测试事项，原有材料上传下载代码未改写。`existingFeatures.e2e.mjs` 验证临时知识文档的真实入库、RAG 和图片 OCR，并清理自己创建的数据。AI 外部网络/模型/配额异常可能使该端到端检查失败，需要结合 AI 服务日志辨别，不能把外部 AI 失败误判为登录通过或权限失败。

## 文件变更索引

- 后端修改：`campus-identity/pom.xml`、`campus-app/src/main/resources/application.yml`、`backend/.env.example`。
- 后端新增：`identity/auth/{AuthController,AuthService}`、`identity/user/{UserView,UserAccount,UserRepository}`、`identity/security/{SecurityConfiguration,JwtService,JwtAuthenticationFilter,AuthCookie,UserPrincipal,LoginSessions}`、`identity/tools/{PasswordHashTool,LocalAccountSeed}`。
- SQL 新增：`V5__auth_rbac.sql`、`db/seed/account_templates.sql`。
- 前端修改：路由、HTTP 客户端、AdminLayout、HomePage、KnowledgeSearchPage；新增 `modules/auth` 下的登录页、无权限页、用户菜单、类型和状态模块。
- 测试/工具：新增 `AuthIntegrationTest`、`auth.e2e.mjs`、`auth.helpers.mjs`、`manage-accounts.ps1`；适配原附件测试、既有浏览器测试与指南验证脚本的认证步骤。
- 文档：本文及 README 登录入口说明。`docs/query-intent-routing.md` 的开发前用户修改予以保留。
