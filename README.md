# CampusAgent

CampusAgent 是面向高校学生的事务智能问答与办事引导系统。本仓库包含文档知识库检索和 RAG 智能问答链路。

本项目目前由AIC  海底小纵队 队伍负责开发与维护

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
Copy-Item .env.example .env
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
模型，首次处理扫描页时会下载并加载 PaddleOCR 模型。这些模型在同一 AI 服务
进程内都只初始化一次。

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
