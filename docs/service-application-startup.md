# CampusAgent 完整启动步骤与手动验收

项目根目录：`D:\AIC_ai-agent\Project\Campus-Agent`。

推荐顺序：MySQL → 后端 → AI Service → 前端。MySQL 是 Windows 服务，不需要长期占一个终端；其余三个服务各用一个 PowerShell 窗口，运行时保持窗口打开。2026-09-27 用户验收通过后，前端、后端和 AI Service 已按要求关闭，MySQL80 保持运行；下次使用请按以下步骤启动。

## 第一步：MySQL

打开 PowerShell，从根目录开始：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent
Get-Service MySQL80
Test-NetConnection 127.0.0.1 -Port 3306
```

当前电脑真实服务名是 `MySQL80`。期望 Status 为 Running，TcpTestSucceeded 为 True。若服务停止，在管理员 PowerShell 执行：

```powershell
Start-Service MySQL80
```

进一步验证数据库（密码是 MySQL 密码，和网页登录密码不同）：

```powershell
mysql -h localhost -P 3306 -u campus_agent -p --default-character-set=utf8mb4
```

账号若与 `backend/.env` 的 DB_USERNAME 不同，以 `.env` 为准。在 `mysql>` 输入：

```sql
USE campus_agent;
SELECT 1;
SHOW TABLES;
```

沿用当前 `campus_agent` 数据库和 `backend/.env`，不要删除重建；后端启动自动执行 V6。全新机器才参考 `docs/auth-rbac.md` 配置数据库账号、JWT_SECRET 和初始用户。

## 第二步：Terminal 1 启动后端

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent
.\scripts\start-backend.ps1
```

此命令读取已有 `backend/.env`，切换到 backend，运行当前已打包 JAR。本次已经打包最终代码。以后修改 Java 源码时，先在原后端窗口 Ctrl+C 停止，再执行：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent
.\scripts\start-backend.ps1 -Build
```

Windows 上不要在旧后端仍运行时打包同一 JAR，否则会因文件被占用导致 repackage 失败。

本机如默认 Maven 仓库连接失败，可用现有镜像设置先构建，再启动：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent\backend
mvn -s ..\tmp\maven-service-guide-settings.xml package
cd D:\AIC_ai-agent\Project\Campus-Agent
.\scripts\start-backend.ps1
```

镜像文件目前已存在于本机 tmp；新机器应使用自己的 Maven settings，不依赖 tmp 被 Git 同步。

后端地址：`http://127.0.0.1:8080`。成功日志包括 `Tomcat started on port 8080` 和 `Started CampusAgentApplication`。在另一个空闲终端验证：

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/v1/health
```

期望 `data.status=UP`。直接访问后端根路径不是健康检查；浏览器业务页面在 5173 端口。

## 第三步：Terminal 2 启动 AI Service

**新开一个 PowerShell 窗口**：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent\ai-service
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

当前 `.venv` 已存在。如果 PowerShell 不允许激活脚本，不必修改系统执行策略，直接执行虚拟环境 Python：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent\ai-service
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

两种方式二选一。全新环境才需要 `python -m venv .venv`、`.\.venv\Scripts\python.exe -m pip install -r requirements.txt`，并配置已有规范的 `.env`。不要覆盖当前带有效配置的 `.env`。

AI 地址：`http://127.0.0.1:8000`。成功日志包括 `Application startup complete`、`Uvicorn running on http://127.0.0.1:8000`。

```powershell
Invoke-RestMethod http://127.0.0.1:8000/internal/v1/health
```

期望 `data.status=UP`。健康检查只验证服务启动；真实问答还依赖外部 Qwen 可连接。当前验收发现 Qwen TLS 超时，独立网络检查也失败，需恢复本机网络/代理到 Qwen 的连通性后重跑真实问答。在线申请不依赖 Qwen；指南可返回数据库流程；OCR 已验证可回退到本地 Paddle。

## 第四步：Terminal 3 启动前端

**再新开一个 PowerShell 窗口**：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent\frontend
npm run dev -- --host 127.0.0.1
```

当前依赖已安装。只有第一次安装或依赖变更才需要在 frontend 执行 `npm ci`。

成功时显示 `http://127.0.0.1:5173/`。浏览器打开：`http://127.0.0.1:5173/login`。不要用 8000 或 8080 打开学生页面。

保持同一浏览器域名使用 `127.0.0.1`，不要在登录后反复切换 localhost 和 127.0.0.1；它们的 Cookie 是分开的。

## 手动测试步骤

先完成上面的 MySQL 和三个服务启动，确认两个健康检查为 UP。

### 测试 1：学生登录

1. 打开 `http://127.0.0.1:5173/login`。
2. 使用现有账号 `20260001` 和其现有密码。系统没有新增或重置密码；本机既有测试账号密码保存在忽略的 `tmp/auth-test-accounts.txt`，需要时在本机打开查看，不要提交该文件。
3. 点击登录，应进入 `/`，显示张三、学号与“我的办事”。
4. 刷新页面，应保持登录。

### 测试 2：学生提交申请

1. 点击“开始提问”，进入 `/knowledge/search`。
2. 输入“学生证丢失了，怎么补办？”，点击发送。
3. 在现有“学生证补办”办事指南卡片查看所需材料、流程。已有模板附件可以先点击下载。
4. 点击“立即办理”，进入 `/student/services/1/apply`（当前库该事项 ID 为 1；以页面实际链接为准）。
5. 确认申请人、学号只读；右侧仍为原办事指南。
6. 填写“手动测试：学生证遗失，申请补办”。
7. 选择真实 PDF、Word 或图片。默认单个文件不超过 20 MB。可点击“移除”后重新选择。
8. 点击“提交申请”。按钮显示 loading，成功提示“申请提交成功。”，跳转新申请详情。
9. 应显示 CA 开头申请编号、事项名、提交时间、已上传附件、状态“已提交”，时间线第一条“已提交”。记录该申请编号。
10. 再进入相同事项办理页，应提示已有办理中申请，并提供“查看办理进度”。

### 测试 3：我的办事

1. 点击右上角“我的办事”，路由 `/student/applications`。
2. 找到记录的申请编号，状态为“已提交”。
3. 试用“办理中”筛选，申请仍在列表内。
4. 点击“查看详情”，检查编号、事项、姓名、学号、说明、附件、时间与状态。
5. 点击下载，检查原始文件名和内容正确。刷新后申请仍然存在。

### 测试 4：管理员审核

1. 点击“退出登录”，回到 `/login`。
2. 使用现有 `admin` 账号和密码登录，进入 `/admin`。
3. 点击侧边栏“办事申请管理”，路由 `/admin/applications`。
4. 用“已提交”筛选找到编号，点击“查看详情”。
5. 查看学生信息、账号、说明和材料，下载附件确认可读。
6. 在“管理员意见”填写“正在审核。”，点击“开始审核”。
7. 应提示状态更新，状态变为“审核中”，时间线新增审核记录。

### 测试 5：学生查看进度

1. 管理员退出，学生 20260001 登录。
2. 进入“我的办事”，打开该申请。
3. 确认“审核中”，管理员意见“正在审核。”正确显示。
4. 已打开详情时可点击“刷新进度”获取最新状态。

### 测试 6：待补充材料

1. 学生退出，admin 登录，打开同一申请。
2. 填写“请补充测试材料。”，点击“要求补充材料”。
3. 状态应为“待补充材料”。
4. admin 退出，学生登录，打开该申请，确认醒目提示和管理员意见。
5. 在补充材料区域填写“已补充测试材料”，选择至少一个新文件。
6. 点击“重新提交”，应提示补充材料已上传，并回到“已提交”。
7. 原附件继续保留，新增文件可下载，原审核意见与历史不丢失。

### 测试 7：审核通过

1. 学生退出，admin 登录，找到申请。
2. **补交后先点击“开始审核”**，由已提交进入审核中。
3. 填写“材料齐全，审核通过。”，点击“审核通过”。
4. admin 退出，学生登录，详情应显示“已通过”。

### 测试 8：办结

1. 学生退出，admin 登录，打开已通过的申请。
2. 填写“办理完成。”，点击“标记办结”，在确认框点击“确认”。
3. admin 退出，学生登录，确认状态“已办结”、办结时间和完整时间线。
4. 不应再显示补充材料上传区域。
5. 再点击原事项“立即办理”，允许创建新的申请。若测试拒绝，则从审核中点击“审核不通过”，填写原因并确认；拒绝后也可重新申请。

### 测试 9：权限

1. 保持学生登录，地址栏输入 `http://127.0.0.1:5173/admin/applications`，应跳到 `/forbidden`。
2. 在学生浏览器开发者工具 Console 执行：

```javascript
fetch('/api/admin/applications', { credentials: 'include' }).then(r => console.log(r.status))
// 应为 403
```

3. 测试真实审核 API 的角色校验（把 123 换成当前申请 ID）：

```javascript
const csrf = (await (await fetch('/api/auth/csrf')).json()).data;
const review = await fetch('/api/admin/applications/123/status', {
  method: 'PATCH', credentials: 'include',
  headers: { 'Content-Type': 'application/json', [csrf.headerName]: csrf.token },
  body: JSON.stringify({ status: 'COMPLETED', remark: '越权测试', version: 0 })
});
console.log(review.status); // 403，即使 CSRF 正确也无权审核
```

4. 退出登录，再执行 `fetch('/api/student/applications').then(r => console.log(r.status))`，应为 401。也可在无 Cookie 的 PowerShell 执行 `curl.exe -i http://127.0.0.1:8080/api/student/applications`。
5. 若使用另一现有测试学生 `20260002`，直接请求第一位学生的 `/api/student/applications/{id}`、其附件下载地址，应返回 403。不存在的申请返回 404。后端自动化已覆盖这一组测试。
6. admin 访问 `/student/services/1/apply` 应被路由阻止，后台不能以管理员身份创建学生申请。

### 测试 10：数据库检查

在 MySQL 客户端执行：

```sql
USE campus_agent;
SELECT id, application_no, service_item_id, service_name,
       user_id, applicant_name, student_no, status, active_slot,
       student_remark, admin_remark, version,
       submitted_at, updated_at, completed_at
FROM service_application
ORDER BY id DESC LIMIT 20;

-- 把 123 改成刚才申请的 id
SELECT id, application_id, original_filename, content_type, file_size, uploaded_at
FROM service_application_attachment WHERE application_id = 123;

SELECT id, from_status, to_status, actor_name, actor_role, remark, created_at
FROM service_application_event WHERE application_id = 123 ORDER BY id;

-- 正常应返回空结果，说明没有重复办理中申请
SELECT user_id, service_item_id, COUNT(*) AS active_count
FROM service_application WHERE active_slot = 1
GROUP BY user_id, service_item_id HAVING COUNT(*) > 1;
```

自动浏览器测试会清理自己创建的记录，因此验收结束后查询不到那条自动申请是正常的。手动创建的申请会保留，拒绝或办结后可重新测试；不要为了重新测试删除原账号、事项或重建数据库。

## 旧功能回归

学生登录后再次尝试普通政策问答、指南查询、模板下载；管理员尝试知识库文本上传与图片 OCR。恢复 Qwen 网络后，使用现有 `existingFeatures.e2e.mjs` 验证答案确实引用新上传证据。当前普通问答的外部连接问题见交付说明，不要通过放开 RBAC 或修改 Cookie 处理来解决网络故障。

## 关机后重新开发速查表

开机先确认 MySQL80 运行，再打开 **3 个终端**：

| 窗口 | 目录 | 命令 |
| --- | --- | --- |
| Terminal 1 后端 | D:\AIC_ai-agent\Project\Campus-Agent | `.\scripts\start-backend.ps1` |
| Terminal 2 AI | D:\AIC_ai-agent\Project\Campus-Agent\ai-service | `.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000` |
| Terminal 3 前端 | D:\AIC_ai-agent\Project\Campus-Agent\frontend | `npm run dev -- --host 127.0.0.1` |

| 入口 | 地址 |
| --- | --- |
| 浏览器 / 学生端 | http://127.0.0.1:5173/ |
| 登录 | http://127.0.0.1:5173/login |
| AI 问答 / 办事指南 | http://127.0.0.1:5173/knowledge/search |
| 我的办事 | http://127.0.0.1:5173/student/applications |
| 管理员后台 | http://127.0.0.1:5173/admin |
| 管理员申请管理 | http://127.0.0.1:5173/admin/applications |
| 管理员知识库 | http://127.0.0.1:5173/admin/knowledge |
| 办事事项管理 | http://127.0.0.1:5173/admin/services |

停止自己开的服务时在对应窗口 Ctrl+C。若提示端口占用，先检查旧实例是否仍在运行，不要重复启动多个服务。
