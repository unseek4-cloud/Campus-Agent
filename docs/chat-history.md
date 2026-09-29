# AI 问答历史记录与手动验收

本功能开发分支：`feature/chat-history`。

## 为什么以前会丢失

`frontend/src/modules/knowledge/pages/KnowledgeSearchPage.vue` 原来使用组件内的 `ref([])` 保存消息，离开路由就会销毁；F5 同样会重新创建空数组。旧的 `clearConversation()` 也只清空这个数组。Java `/api/rag/chat` 调用现有 `ChatService`，Python `app/conversation/query_rewriter.py` 只接收临时上下文来改写问题，两者都没有保存用户会话。

新功能启用前已经消失的记录无法补回；启用后的问题、回答会持久保存到 MySQL。

## 实现说明

### 数据库与 migration

沿用现有 Spring SQL Init 自动执行版本化、可重复 SQL 的机制。本项目当前没有 Flyway / Liquibase。新增 `backend/campus-app/src/main/resources/db/migration/V7__chat_history.sql`，并加入 `application.yml` 的 `spring.sql.init.schema-locations`。后端启动时自动升级已有数据库，无需手动创建聊天表，不修改旧版本 migration。

| 表 | 内容 |
| --- | --- |
| `ai_conversation` | id、user_id、title、created_at、updated_at，以及用于处理并发/恢复中断请求的 pending_request_id、pending_since |
| `ai_message` | id、conversation_id、request_id、role、content、sources_json、created_at |

`user_id` 外键关联 `user_account.id`；消息外键关联会话；删除会话会 `ON DELETE CASCADE` 删除消息。会话列表按 `updated_at DESC,id DESC`；消息按 `created_at ASC,id ASC` 排序。索引分别为 `(user_id,updated_at)`、`(conversation_id,created_at)`；唯一约束 `(conversation_id,request_id,role)` 防止重复保存同一次发送。

标题取第一条问题的前 30 个 Unicode 字符，不额外调用模型。空会话显示“新对话”。

`sources_json` 保存必要来源摘要（每个引用最多 400 个字符），以及现有办事指南卡片、步骤、来源和附件描述；答案完整保存在 `content`。不保存原始 Chunk、embedding、改写问题、模型日志或检索计数。历史引用显示“查看引用摘要”。实时回答仍展示现有完整响应，回答正文不改写。

### API 与发送时序

响应继续使用项目统一的 `ApiResponse` 包装，实际业务内容在 `data`。

| 接口 | 功能 |
| --- | --- |
| `GET /api/chat/conversations` | 当前登录用户的会话列表 |
| `POST /api/chat/conversations` | 新建会话 |
| `GET /api/chat/conversations/{id}/messages` | 返回 `{messages: [...], pending: boolean}` |
| `DELETE /api/chat/conversations/{id}` | 删除自己的会话及其消息 |
| `POST /api/rag/chat` | 沿用现有问答入口，新增 `conversationId`、UUID `requestId`；响应保留原问答字段并增加会话和消息 ID |

前端没有会话时先创建会话，再发送问题。后端短事务锁定当前用户的会话，检查请求 ID 和生成状态，保存 USER 消息并提交；随后在事务之外调用原来的 ChatService / RAG / Qwen；成功后用第二个短事务保存 ASSISTANT 消息。AI 失败只保留 USER 消息，不伪造回答。

前端发送时禁用重复操作，不自动重试 POST。后端对相同会话、相同请求 ID 返回已保存结果，进行中的重复请求返回 409，不重复调用模型。相同请求 ID 不得复用于不同问题。失败后的同一次请求可在尚无后续问题时重试。正常页面每次新发送会产生新 UUID。

会话使用数据库生成状态阻止多标签页并发发送；服务器异常退出留下的状态 5 分钟后过期。会话在回答途中被另一个客户端删除时，后端不会重新创建它。旧调用方不传会话 ID 时会自动创建会话；想要请求重试去重，应先创建会话并固定传入会话 ID 和请求 ID。

### 恢复、切换与删除

每次问答页挂载都从服务器读取列表及消息。localStorage 仅保存 `campusagent:last-conversation:<用户ID>`，值是会话 ID，不保存聊天正文。优先恢复属于当前用户的最近选择；ID 无效或不存在时加载最近更新的会话。禁用浏览器存储时也能恢复服务器上最近的会话。

切换页面、F5、同一账号重新登录均走这一恢复流程。发送中离开页面后返回，若服务器仍在生成，页面每 1.8 秒同步当前会话；完成后停止轮询。组件卸载后停止轮询，不让旧请求回调污染另一账号的页面。

桌面左侧显示历史列表，手机宽度可以“展开/收起”。点击列表切换。原“清空对话”改为“新建对话”，不会删除旧记录。点击每条记录旁的“删除”，Element Plus 弹窗二次确认；删除当前会话后恢复最近的一条，没有剩余会话时显示空白新对话。

### 用户隔离

控制器从 Spring Security 的 `@AuthenticationPrincipal UserPrincipal` 获取 `user.user().id()`；该身份由 JWT HttpOnly Cookie、登录会话和数据库账户校验建立。接口不接受前端 userId 作为权限依据。查询、加载、发送、删除都按当前用户限定；ADMIN 同样没有越权特例。不存在和不属于当前用户的会话统一返回 404；未登录返回 401。继续使用原有 CSRF 防护。

API 只返回专用 DTO，不返回 user_account、密码散列或 JWT。Java 意图识别和 Python RAG 中原有问题正文日志已移除。

## 文件清单

新增：

- `backend/campus-ai-integration/src/main/java/com/campusagent/aiintegration/history/ChatHistoryTypes.java`
- `backend/campus-ai-integration/src/main/java/com/campusagent/aiintegration/history/ChatHistoryRepository.java`
- `backend/campus-ai-integration/src/main/java/com/campusagent/aiintegration/history/ChatHistoryService.java`
- `backend/campus-ai-integration/src/main/java/com/campusagent/aiintegration/history/ChatHistoryController.java`
- `backend/campus-app/src/main/resources/db/migration/V7__chat_history.sql`
- `backend/campus-app/src/test/java/com/campusagent/app/chat/ChatHistoryIntegrationTest.java`
- `frontend/src/modules/knowledge/history/api.ts`
- `frontend/src/modules/knowledge/history/useChatHistory.ts`
- `frontend/src/modules/knowledge/history/ChatHistory.vue`
- `frontend/tests/chatHistory.test.mjs`
- `frontend/tests/browser/chatHistory.e2e.mjs`
- `docs/chat-history.md`

修改：

- `backend/campus-ai-integration/src/main/java/com/campusagent/aiintegration/rag/RagController.java`
- `backend/campus-app/src/main/resources/application.yml`
- `backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/service/DatabaseServiceIntentRecognizer.java`
- `ai-service/app/services/rag_service.py`
- `ai-service/app/api/error_handlers.py`（校验失败日志不再包含请求输入）
- `frontend/src/modules/knowledge/pages/KnowledgeSearchPage.vue`
- `frontend/src/modules/knowledge/types.ts`
- `frontend/.env.example`（移除不再使用的浏览器上下文长度配置）
- `frontend/tests/queryIntentRendering.test.mjs`
- `frontend/tests/browser/queryIntent.e2e.mjs`
- `README.md`、`ai-service/README.md`（更新持久化说明及文档入口）

## 聊天历史功能手动验收步骤

以下以 Windows PowerShell、项目 `D:\AIC_ai-agent\Project\Campus-Agent`、MySQL80、后端 8080、AI 8000、前端 5173 为例。三个服务各使用一个终端，运行期间不要关闭；同一端口只启动一个实例。已有 `.env` 不要覆盖。

### 1. 启动 MySQL

在管理员 PowerShell 执行：

```powershell
Get-Service *mysql*
Start-Service MySQL80
Get-Service MySQL80
```

预期：状态是 `Running`。若服务名称不是 MySQL80，使用第一条命令查到的实际名称；已经运行可跳过 Start-Service。

原项目数据库 `campus_agent` 和数据库账号继续使用。可验证：

```powershell
mysql -h localhost -u campus_agent -p campus_agent
```

按提示输入你在 `backend/.env` 中配置的数据库密码，成功后输入 `exit`。预期：能连上原数据库；不需要手动执行聊天表建表 SQL。

### 2. 检查后端配置

```powershell
Set-Location D:\AIC_ai-agent\Project\Campus-Agent
if (!(Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
notepad backend/.env
```

核对 `DB_URL`、`DB_USERNAME`、`DB_PASSWORD`、`JWT_SECRET`、`AI_SERVICE_BASE_URL`；AI 地址一般是 `http://localhost:8000`。沿用现有 JWT 配置。预期：指向原来有 user_account 的数据库，配置文件保留在本机。

### 3. 启动后端（终端一）

```powershell
Set-Location D:\AIC_ai-agent\Project\Campus-Agent
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1 -Build
```

预期：Maven 测试与构建成功，出现 `Started CampusAgentApplication` 和 `Tomcat started on port 8080`。脚本会读取 `backend/.env`，V7 自动执行。首次更新必须使用 `-Build`，避免运行旧 jar。

另开终端检查：

```powershell
Invoke-RestMethod http://localhost:8080/api/v1/health
```

预期：健康检查成功。若提示数据库连接失败，先修正第 1、2 步；若端口占用，停止先前的后端后再启动。

### 4. 启动 AI service（终端二）

```powershell
Set-Location D:\AIC_ai-agent\Project\Campus-Agent\ai-service
if (!(Test-Path .venv/Scripts/python.exe)) { python -m venv .venv }
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

沿用原知识库目录和模型配置，核对有效的 `AI_QWEN_API_KEY`、Qwen 地址和模型。保存后运行：

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

预期：出现 `Application startup complete`。已有虚拟环境且依赖完整时可跳过安装步骤。

```powershell
Invoke-RestMethod http://localhost:8000/internal/v1/health
```

预期：健康检查成功。首次问答可能需要加载本地模型。已有知识库文档可直接复用；没有相关文档时“根据当前知识库暂未找到相关信息。”也是可保存的正常回答，但不代表政策知识库验收通过。

### 5. 启动前端（终端三）

```powershell
Set-Location D:\AIC_ai-agent\Project\Campus-Agent\frontend
npm install
npm run dev -- --host 127.0.0.1
```

预期：出现 Vite 地址 `http://127.0.0.1:5173/`。始终使用同一地址，不要在 localhost 和 127.0.0.1 间切换，以免混淆不同主机的 Cookie。已有依赖时可跳过 npm install。

### 6. 登录张三

打开 `http://127.0.0.1:5173/login`，账号输入 `20260001`，密码输入之前为张三设置的密码，点击“登录”，然后“开始提问”。

预期：右上角显示张三，进入“校园事务智能问答”，左侧出现“历史对话”。不硬编码或重置现有账号密码。

如果本地从未创建测试账号，在后端已启动完成后另开终端执行：

```powershell
Set-Location D:\AIC_ai-agent\Project\Campus-Agent
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\manage-accounts.ps1 -Action Seed
```

预期：只创建缺失的 admin、20260001、20260002，并在你的终端显示一次随机密码；已存在账号只显示跳过，不会改密码。忘记已有密码时按 `docs/auth-rbac.md` 的密码重置步骤处理。

### 7. 创建第一条会话并连续提问

点击“新建对话”，依次发送以下问题，每次等回答完成后再发下一条：

1. 国家奖学金申请需要满足什么条件？
2. 需要哪些材料？
3. 奖学金申请流程是什么？

预期：三条用户消息、三条成功回答按顺序显示；标题自动变成第一条问题；来源和办事卡片正常。发送中按钮禁用，多次点击不会产生同一次请求的重复消息。

### 8. 进入“我的办事”后返回

点击右上角“我的办事”，看到申请列表后，点击顶部“AI 问答”。

预期：自动恢复刚才的会话和六条消息，不出现空白“输入第一个问题”。历史记录从服务器读取；引用显示摘要，原始调试信息无需恢复。

### 9. F5 刷新

在问答页面按 F5，等待“正在恢复历史对话…”结束。

预期：相同会话、相同消息顺序和完整回答恢复。可关闭标签页后再次进入，结果相同。

### 10. 退出并重新登录

点击“退出登录”，再次用 `20260001` 和原密码登录，点击“开始提问”。

预期：第一条会话仍存在，自动恢复最近选择的会话。退出登录不会删除 MySQL 消息。

### 11. 创建第二个会话

点击“＋ 新建对话”，发送“学生证丢了怎么补办？”。

预期：新会话显示独立问题和回答；历史栏同时保留第一条会话。已有对应办事指南时显示流程卡片；刷新后卡片、材料下载入口仍在。

### 12. 来回切换历史会话

点击左侧第一条奖学金会话，再点击学生证会话。

预期：分别显示各自的消息，不串话；选中项有浅蓝色背景。输入框不携带另一个会话的未发送草稿。

### 13. 删除第二个会话

点击学生证会话旁“删除”，先点“取消”。预期：会话仍在。

再次点击“删除”，在弹窗中确认。预期：第二条会话从数据库和列表移除；若它是当前会话，自动切回最近的第一条；第一条的六条消息不变。F5 后第二条也不会回来。

### 14. 验证张三与李四的数据隔离

保持张三登录，另开同一浏览器标签页访问 `http://127.0.0.1:5173/api/chat/conversations`，从 `data` 记下第一条会话的 `id`，例如 12。不要把示例 12 当作你的实际 ID。

回到应用退出张三，使用 `20260002` 和李四的密码登录。预期：只出现李四自己的历史，新账号没有历史；看不到张三的奖学金问题。给李四发送“李四的独立测试问题”，预期：创建属于李四的会话。

在李四登录状态访问 `http://127.0.0.1:5173/api/chat/conversations/12/messages`（12 替换为张三实际 ID）。预期：404、`CHAT_NOT_FOUND`，没有张三正文。

在李四页面按 F12 打开开发者工具 Console，用实际 ID 替换下面的 12，执行：

```javascript
const targetId = 12;
const csrf = (await (await fetch('/api/auth/csrf')).json()).data;
const denied = await fetch(`/api/chat/conversations/${targetId}`, {
  method: 'DELETE', headers: { [csrf.headerName]: csrf.token }
});
console.log(denied.status, await denied.json());
```

预期：404，不能删除张三会话。再访问 `/api/chat/conversations?userId=1`，预期仍只返回李四自己的列表；随意修改 userId 无效。

退出李四，重新登录张三。预期：第一条奖学金会话仍完整；李四的独立测试问题不出现在张三历史中。管理员普通聊天接口也遵循同一归属规则，自动测试已覆盖。

### 15. 验证未登录访问

打开浏览器 InPrivate/无痕窗口，不登录，访问 `http://127.0.0.1:5173/api/chat/conversations`。

预期：401、`AUTH_REQUIRED`，没有聊天记录。直接进入问答页会转到登录页。

### 16. 验证 AI 失败和发送途中离开

可暂时在 AI service 终端按 Ctrl+C 停止 AI，再问一个普通政策问题。预期：出现请求失败提示，USER 问题仍保存在历史中，不出现假的 AI 成功回答。重新启动 AI 后可以继续提问。

正常发送一个需要模型回答的问题后立即进入“我的办事”，再返回“AI 问答”。预期：已经保存的 USER 消息恢复；若 AI 仍在生成会显示等待状态，生成完成后自动补齐回答。服务进程意外中断的生成状态最多保留 5 分钟，再次发送前不会卡死。

### 17. 可选：直接确认数据库

使用第 1 步的 MySQL 登录方式，只执行查询：

```sql
SHOW TABLES LIKE 'ai_%';
SELECT c.id,u.username,c.title,c.created_at,c.updated_at
FROM ai_conversation c JOIN user_account u ON u.id=c.user_id
ORDER BY c.updated_at DESC,c.id DESC;
SELECT id,conversation_id,role,CHAR_LENGTH(content) AS content_length,created_at
FROM ai_message ORDER BY conversation_id,created_at,id;
```

预期：两张聊天表存在，每次成功发送有 USER 和 ASSISTANT 各一条，失败仅有 USER；删除会话后其消息同步消失。数据库管理员查询是开发验收手段，不是向学生暴露的接口。

## 自动测试

```powershell
Set-Location D:\AIC_ai-agent\Project\Campus-Agent\backend
mvn test
Set-Location ..\frontend
npm test
npm run build
Set-Location ..\ai-service
.\.venv\Scripts\python.exe -m pytest -q
```

后端集成测试使用 H2 MySQL 模式并模拟 AI 边界，覆盖真实登录 Cookie / CSRF、持久化、顺序、重复请求、生成并发、失败保留、删除级联、重新登录、跨用户及 ADMIN 隔离、匿名 401、重复 migration；原有 RAG、意图路由、办事和附件测试继续运行。前端测试运行实际 composable 并模拟 API，覆盖组件重新挂载、恢复、失败、并发发送和不同账号；真实浏览器脚本再验证完整服务。

浏览器脚本：`frontend/tests/browser/chatHistory.e2e.mjs`。先启动全部服务，设置 `STUDENT_USERNAME` / `STUDENT_PASSWORD`、`SECOND_STUDENT_USERNAME` / `SECOND_STUDENT_PASSWORD`；可配置 `CAMPUS_BASE_URL`、`PLAYWRIGHT_MODULE_PATH`、`BROWSER_EXECUTABLE`。默认使用本地已有的 `tmp/browser-check/node_modules/playwright-core/index.mjs` 和 Edge。运行 `node frontend/tests/browser/chatHistory.e2e.mjs`。脚本只删除它自己创建的验收会话，截图输出到 `tmp/chat-history-browser/`。

## 本次验证结果

2026-09-29 验证：后端 Maven 108 项、前端 Node 32 项、AI service Pytest 136 项全部通过；前端类型检查与生产构建通过。使用本机真实 MySQL、Java 后端、Python AI service、Qwen 和 Edge 完成浏览器验收：三轮聊天、页面返回、F5、重新登录、两会话切换、历史办事卡片、取消/确认删除、跨用户读取/删除拒绝、匿名 401、390px 手机宽度均通过。后端启动实际自动执行 V7；测试创建的会话已清理，现有账号和原会话保留。

构建仍有原有前端大 bundle 提示，Python 有依赖弃用提示；均不影响本次检查通过。已有聊天正文的展示方式保持原样，本次不新增或替换 Markdown 渲染器。
