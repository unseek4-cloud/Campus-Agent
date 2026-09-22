# CampusAgent

CampusAgent 是面向高校学生的事务智能问答与办事引导系统。本仓库包含文档知识库检索和 RAG 智能问答链路。

本项目目前由AIC  海底小纵队 队伍负责开发与维护

## 智能办事流程引导 V1

新增结构化办事引导及管理员事项管理。学生端继续使用 `/api/rag/chat`，识别到事项时展示条件、材料、步骤与来源卡片，未命中继续原 RAG；AI 离线也能返回数据库流程。管理员入口为 `/admin/services`。五项示例需显式导入 SQL，均标记为测试数据，不代表学校政策。

数据库升级、Windows 启动、API、测试问题、文件清单及功能边界见 [办事流程 V1 开发与验收说明](docs/service-guide-v1.md)。可用 `scripts/start-backend.ps1` 读取既有 `backend/.env` 启动 Java。

## 智能办事进度跟踪 V1.1

学生可在办事卡片中完成当前步骤、回退、查看进度和重新开始；各事项进度及材料勾选按业务编码独立保存到当前浏览器。仅表示用户确认完成引导步骤，不代表学校审批。无需修改数据库或 API，管理员预览与普通 RAG 保持兼容。

实现结构、Windows 启动、缓存算法、测试结果与已知限制见 [办事进度 V1.1 开发与验收说明](docs/service-progress-v1.1.md)。

## 项目结构

```text
frontend/     Vue 3 + Vite + Element Plus + Axios
backend/      Java 21 + Spring Boot 3 + MyBatis-Plus + MySQL
ai-service/   Python + FastAPI
docs/         项目文档
deploy/       部署配置预留目录
scripts/      开发和运维脚本预留目录
```

## 环境要求

- Node.js 20.19+ 或 22.12+
- npm 10+
- JDK 21
- Maven 3.6.3+
- Python 3.11–3.13（AI 服务 OCR 当前在 Python 3.12 上验证）
- MySQL 8.x

## 启动前端

```bash
cd frontend
npm install
npm run dev
```

默认地址：`http://localhost:5173`。

## 启动 Java 后端

先创建数据库并配置环境变量：

```sql
CREATE DATABASE campus_agent CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

PowerShell 示例：

```powershell
$env:DB_URL = "jdbc:mysql://localhost:3306/campus_agent?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true"
$env:DB_USERNAME = "campus_agent"
$env:DB_PASSWORD = "replace-me"
cd backend
mvn clean package
java -jar campus-app/target/campus-app-0.1.0-SNAPSHOT.jar
```

健康检查：`http://localhost:8080/api/v1/health`。Java 后端通过
`AI_SERVICE_BASE_URL`（默认 `http://localhost:8000`）访问 Python AI 服务。

## 启动 AI 服务

PowerShell 示例：

```powershell
cd ai-service
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
if (!(Test-Path .env)) { Copy-Item .env.example .env }
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Linux/macOS 示例：

```bash
cd ai-service
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：`http://localhost:8000/internal/v1/health`，OpenAPI 文档：`http://localhost:8000/docs`。

首次处理文档时会下载并加载 Embedding 模型，首次检索时会加载 Rerank
模型。扫描页在 `hybrid` 模式下优先调用 Qwen OCR，失败时下载并加载 PaddleOCR 模型；本地模型在同一 AI 服务进程内只初始化一次。OCR 的 Windows 配置和验收步骤见 [升级指南](docs/ocr-upgrade.md)。

## RAG 检索开发链路

```text
PDF / DOCX
  → 文本提取（PDF 无文本页才执行 OCR）
  → 按页、段落和句子边界切块
  → Sentence Transformers Embedding
  → Chroma 持久化
  → 查询 Embedding
  → 余弦相似度候选召回
  → 本地 CrossEncoder Rerank
  → 时间类问题的日期证据校验
  → Rerank 分数过滤与 Context Builder
  → 千问 OpenAI Compatible API
  → Java API
  → 前端答案和引用来源
```

检索公共接口：`POST http://localhost:8080/api/knowledge/search`。
问答公共接口：`POST http://localhost:8080/api/rag/chat`。

前端问答页：`http://localhost:5173/knowledge/search`，原始检索结果在“检索调试”区域。

## 多轮问答

问答页在当前浏览器页面内保存消息列表，按轮展示回答和对应来源。发送新问题时，前端只携带该问题**之前**最近的消息；刷新页面或点击“清空对话”会清除当前会话。无需 Redis 或会话数据库。

```text
当前问题 + 最近历史 → Python Query Rewriter → 独立检索问题
→ 原有 Retrieval / Rerank / Context Builder → 基于本次知识库 Context 的回答与来源
```

Query Rewrite 只补全省略的主题或代词，例如将“对象是谁？”补成“2026级新生心理测评对象是谁？”。改写问题仅用于检索；最终回答针对原问题，历史 Assistant 文本不会进入最终回答 Prompt，也不会作为学校事实或引用来源。改写失败时使用原问题继续检索。无 `history` 的旧单轮请求直接跳过改写，接口保持兼容。

Java 公共接口 `POST /api/rag/chat` 的多轮请求示例：

```json
{
  "query": "对象是谁？",
  "history": [
    { "role": "user", "content": "2026级新生心理测评什么时候？" },
    { "role": "assistant", "content": "2026年9月19日至22日。" }
  ]
}
```

响应的 `data.rewrittenQuery` 可在问答页每轮的“本轮调试信息”中查看。来源只对应本次进入 Context 的 Chunk。`AI_CONVERSATION_MAX_MESSAGES` 控制 Python 最多用于改写的最近消息数，默认 8；前端的 `VITE_CONVERSATION_MAX_MESSAGES` 控制发送上限，也默认 8。调整时建议两者一致。`AI_QUERY_REWRITE_ENABLED=false` 可关闭改写；`AI_QUERY_REWRITE_TEMPERATURE=0` 是默认改写温度。这些设置写在各自的 `.env.example` 中，实际密钥只放本地 `.env`。

本地验证：入库心理测评通知后，在网页先问“2026级新生心理测评什么时候？”，再问“对象是谁？”或“在哪里进行？”，核对 `rewrittenQuery` 和对应来源；随后问“奖学金申请需要什么材料？”，确认改写没有混入心理测评；再问知识库不存在的“火星校区怎么坐飞船过去？”，应返回“根据当前知识库暂未找到相关信息。”。自动测试：在 `ai-service` 运行 `python -m pytest`，在 `backend` 运行 `mvn test`，在 `frontend` 运行 `npm run build`。自动多轮测试使用模拟 Provider，不消耗千问额度。

在 `ai-service/.env` 填入 `AI_QWEN_API_KEY` 后即可使用问答。千问模型、地址、超时和 Context 过滤参数见 [`ai-service/README.md`](ai-service/README.md)。

若本机可直连千问但问答报连接超时，检查系统代理是否失效。千问客户端默认使用 `AI_QWEN_TRUST_ENV=false` 直连；确需代理时再设为 `true`，详见 AI 服务 README。

文档处理、删除向量和 AI 内部检索接口的调用示例见
[`ai-service/README.md`](ai-service/README.md)。

## 当前边界

- 浏览器只访问 Java 后端，不直接访问 AI 服务。
- Java 后端负责业务、权限和 MySQL 数据。
- Python 服务只承载文档解析、OCR、Embedding、向量存储和检索等 AI 能力。
- 业务模块只能通过公开契约协作，禁止跨模块访问 Mapper、Entity 或数据表。

## 管理员知识库

启动三个服务后访问 [管理员端](http://localhost:5173/admin)。`/admin` 展示真实文档统计和最近上传，`/admin/knowledge` 提供搜索、类型与状态筛选、分页、批量上传、详情、重命名、重新解析和删除。Swagger 与 Python OpenAPI 继续用于开发调试；日常知识库管理请使用管理员页面。本阶段尚无登录系统，**正式部署前必须接入管理员认证并限制 `/api/admin/**`**，切勿将当前接口直接开放到公网。

上传支持 PDF、DOCX、TXT、Markdown、XLSX、PPTX、PNG、JPG/JPEG；不支持 DOC/XLS/PPT 等旧版 Office 格式。默认单文件上限 20 MB，由 Java 的 `ADMIN_MAX_UPLOAD_SIZE_MB` 配置，Python 的 `AI_MAX_PDF_SIZE_MB` 应设为相同或更高。前端从 Java 配置接口读取上限；Java 与 Python 均校验文件类型和内容。TXT/Markdown 使用 UTF-8；PDF 保留现有文本层与扫描页 OCR；DOCX 保留现有解析器；XLSX 按工作表提取表头和行；PPTX 按幻灯片提取文字及页码；图片也使用 OCRManager。所有格式复用同一清洗、Chunk、Embedding、Chroma 入库流程。

Java 在上传时计算 SHA-256，并通过 `(knowledge_base_id, file_hash)` 唯一约束防止同内容以不同文件名重复入库。元数据存入 MySQL 的 `knowledge_document` 表，原文件保存到 `ADMIN_DOCUMENT_STORAGE_PATH`（默认从 backend 工作目录计算的 `var/documents`），Chunk 和引用信息保存在 Chroma。`schema.sql` 在新数据库启动时创建元数据表；已有数据库执行 [V2 迁移](backend/campus-app/src/main/resources/db/migration/V2__document_ocr_progress.sql)。上传后后台解析，失败保留文档记录和原文件，状态为 `FAILED`，可重新解析。删除先清除 Chroma 向量，再清理原文件和数据库记录；任何步骤失败时 API 不返回成功。重命名同步更新 Chroma 的 `file_name` 与 `source` 引用元数据，不重新计算 Embedding。

新增格式时，在 `ai-service/app/services/document_parsers.py` 实现返回 `DocumentPage` 的解析器，将扩展名、MIME 和文件头校验加入 `ParserRegistry`，再于 `get_document_service()` 注册。后续 Chunk、Embedding 与向量存储无需修改。

手工验收：进入 `/admin/knowledge` 上传一份文档，确认解析状态与片段数；将同一文件改名再上传，应显示重复提示且文档数不增加；在文档操作菜单中重命名后到学生端提问并核对来源；执行重新解析后检查片段数；删除后检查列表和学生端检索均不再出现该文档。自动验证命令：`ai-service/.venv/Scripts/python.exe -m pytest -q --basetemp .pytest-tmp`、在 `backend` 运行 `mvn test`、在 `frontend` 运行 `npm run build`。需要 MySQL、模型和千问 Key 的真实端到端问答验收仍须在完整运行环境执行。
