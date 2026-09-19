# CampusAgent

CampusAgent 是面向高校学生的事务智能问答与办事引导系统。本仓库当前仅包含可独立启动的基础骨架，不包含具体业务实现。

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
  → Java API
  → 前端检索测试页
```

检索公共接口：`POST http://localhost:8080/api/knowledge/search`。

前端测试页：`http://localhost:5173/knowledge/search`。

文档处理、删除向量和 AI 内部检索接口的调用示例见
[`ai-service/README.md`](ai-service/README.md)。

## 当前边界

- 浏览器只访问 Java 后端，不直接访问 AI 服务。
- Java 后端负责业务、权限和 MySQL 数据。
- Python 服务只承载文档解析、OCR、Embedding、向量存储和检索等 AI 能力。
- 业务模块只能通过公开契约协作，禁止跨模块访问 Mapper、Entity 或数据表。
