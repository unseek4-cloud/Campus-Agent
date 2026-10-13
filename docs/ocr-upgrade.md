# 管理员文档 OCR 升级：Windows 启动与验收

## 流程

原流程是 Java 计算 SHA-256 并去重、同步调用 Python、pypdf 按页提取文本、无文本页顺序渲染并由 PaddleOCR 识别、清洗、Chunk、批量 Embedding、Chroma 入库，最后更新 MySQL。多页扫描 PDF 的顺序本地推理使上传请求长期等待。

现在上传保存文件后立即返回 `taskId=documentId` 和 `PROCESSING`，后台执行解析。Python 仍先提取文本层，只把低于阈值的页面按 200 DPI 渲染成图片。Qwen OCR 在有限并发下识别；`hybrid` 模式出错时使用原有 PaddleOCR 单例，最终按原页码合并。Java API 每 1.5 秒接收前端轮询并转发 Python 的实时进度。Embedding 继续使用现有批量实现。

## 已有 MySQL 数据库迁移

已有 `knowledge_document` 表时，在启动新 Java 版本**之前**执行以下完整 SQL 一次。新数据库由 `schema.sql` 自动创建这些字段。迁移文件是 `backend/campus-app/src/main/resources/db/migration/V2__document_ocr_progress.sql`。

```sql
ALTER TABLE knowledge_document
    ADD COLUMN parse_status VARCHAR(24) NOT NULL DEFAULT 'UPLOADED',
    ADD COLUMN progress INT NOT NULL DEFAULT 0,
    ADD COLUMN total_pages INT NOT NULL DEFAULT 0,
    ADD COLUMN processed_pages INT NOT NULL DEFAULT 0,
    ADD COLUMN ocr_provider VARCHAR(32) NOT NULL DEFAULT 'none';

UPDATE knowledge_document
SET parse_status = CASE status WHEN 'SUCCESS' THEN 'COMPLETED' WHEN 'FAILED' THEN 'FAILED' ELSE 'UPLOADED' END,
    progress = CASE status WHEN 'SUCCESS' THEN 100 ELSE 0 END;
```

在 PowerShell 输入 `mysql -u campus_agent -p campus_agent`，输入数据库密码后，在出现 `mysql>` 提示符时输入：

```sql
source D:/AIC_ai-agent/Project/Campus-Agent/backend/campus-app/src/main/resources/db/migration/V2__document_ocr_progress.sql
SHOW COLUMNS FROM knowledge_document;
```

看到 `parse_status`、`progress`、`total_pages`、`processed_pages`、`ocr_provider` 即成功。

## AI 服务环境变量

保留 `ai-service/.env` 已有配置，加入或修改以下值。真实 Key 只放本地 `.env`，不要提交到 Git。

```dotenv
AI_OCR_ENABLED=true
AI_OCR_MODE=hybrid
AI_OCR_ALLOW_CLOUD=true
AI_OCR_MAX_CONCURRENCY=4
AI_OCR_DPI=200
AI_OCR_TEXT_THRESHOLD=50
AI_OCR_MAX_PAGES_PER_DOCUMENT=50
AI_OCR_DEVICE=cpu
AI_QWEN_OCR_ENABLED=true
AI_QWEN_OCR_MODEL=qwen3.5-ocr
AI_QWEN_OCR_API_KEY=
AI_QWEN_OCR_BASE_URL=
AI_QWEN_OCR_TIMEOUT=120
AI_QWEN_OCR_MAX_RETRIES=2
AI_EMBEDDING_BATCH_SIZE=32
```

`AI_QWEN_OCR_API_KEY` 留空时复用 `AI_QWEN_API_KEY`，再读取进程环境中的 `DASHSCOPE_API_KEY`。OCR 模型独立于聊天模型 `AI_QWEN_MODEL`。OCR Base URL 留空时复用 `AI_QWEN_BASE_URL`。使用 `qwen3.5-ocr` 时，建议填写与 Key 地域匹配的百炼业务空间兼容地址，例如 `https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。`AI_OCR_MODE=paddle` 完全本地；`AI_OCR_MODE=qwen` 的云端失败会使任务失败；`AI_OCR_ALLOW_CLOUD=false` 无论模式如何都强制本地。首次本地识别会加载或下载 Paddle 模型，后续使用缓存。

## Windows 启动

先确认 MySQL 已启动、数据库已创建且迁移已执行。打开三个 PowerShell 窗口。

**窗口 1，Python AI 服务：**

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent\ai-service
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# 编辑 .env，填入 Qwen Key 和对应的 OCR Base URL
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

看到 `Application startup complete` 后，在浏览器打开 `http://localhost:8000/internal/v1/health`。
进度暂存在 AI 服务进程内存中，因此当前部署请保持一个 Uvicorn worker；文档记录和最终状态仍保存在 MySQL。Java 重启会把未完成任务标记为失败，可从管理员页面重新解析。

**窗口 2，Java 后端：**

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent\backend
$env:DB_URL = "jdbc:mysql://localhost:3306/campus_agent?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true"
$env:DB_USERNAME = "campus_agent"
$env:DB_PASSWORD = "你的数据库密码"
mvn clean package -DskipTests
java -jar campus-app/target/campus-app-0.1.0-SNAPSHOT.jar
```

看到 Spring Boot 启动完成后，在浏览器打开 `http://localhost:8080/api/v1/health`。

**窗口 3，前端：**

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent\frontend
npm install
npm run dev
```

在浏览器打开 `http://localhost:5173/admin/knowledge`。

## 一步一步验收

1. 上传普通文字 PDF。页面显示处理进度直至“已入库”；AI 日志中 `scanned=0`，没有页级 OCR 日志。列表的 OCR 方式是“无需 OCR”。学生端在 `/knowledge/search` 提问 PDF 中明确出现的内容，答案应带该文档来源。
2. 上传三页扫描 PDF。日志出现 `provider=qwen` 和 `qwen=3`；列表最终页数为 3，状态“已入库”。若 Key 或地址不可用，混合模式会显示本地回退。
3. 上传 20 页扫描 PDF。观察 `OCR 识别中 1 / 20` 到 `20 / 20`，百分比不倒退；记录日志的 `qwen=20`、`ocr_seconds`、`embedding_seconds`、`total_seconds`。要与本地旧方式比较，等待该任务完成后把 `AI_OCR_MODE` 改为 `paddle`，重启 Python 服务，对**同一文档**点击“重新解析”，记录第二次的 OCR 和总耗时；测试后恢复 `hybrid`。再分别用 10 页和 50 页扫描 PDF 做同样对照。若 50 页超过设置的扫描页上限，先提高 `AI_OCR_MAX_PAGES_PER_DOCUMENT`。
4. 上传“文字页、扫描页、文字页”的混合 PDF。日志应只出现扫描页的 OCR 页号；详情页数为 3。学生端分别问文字页和扫描页中的独有内容，确认引用仍指向正确页。
5. 将 `AI_QWEN_OCR_API_KEY` 暂时设为无效值并重启 Python 服务，上传**另一份**扫描 PDF。日志出现 Qwen 请求失败及 `fallback=paddle`；列表显示“Qwen → PaddleOCR”。恢复 Key 后重启。测试超时可把 `AI_QWEN_OCR_TIMEOUT` 暂时设得很短，再上传另一份文件。
6. 将 `AI_OCR_MODE=paddle` 或 `AI_OCR_ALLOW_CLOUD=false`，重启 Python 服务并上传新的扫描 PDF。日志不应出现 Qwen 请求，列表显示 PaddleOCR。测试后恢复变量并重启。
7. 把已成功上传的文件改名后再次上传。页面提示重复并指向已有文档；数据库文档数、OCR 页数和向量数不增加。
8. 对失败文档点击“重新解析”，确认仍是同一文档 ID，并从解析、OCR、Chunk、Embedding 到入库重新运行。若两种 OCR 都失败，状态应为“处理失败”，学生端检索不应看到该失败文档的片段。
9. 回归测试 RAG：进入学生端 `/knowledge/search`，问一条刚入库文档中的事实，确认回答和引用；再问未知事实，确认仍按原有知识库边界回答。多轮问答可先问主题，再问“对象是谁？”，核对本轮改写和来源。

自动测试：在 `ai-service` 执行 `.\.venv\Scripts\python.exe -m pytest -q --basetemp .pytest-tmp`，在 `backend` 执行 `mvn test`，在 `frontend` 执行 `npm run build`。单元测试使用模拟 Qwen/Paddle，不消耗 API 额度；真实云端调用、MySQL 和浏览器全链路需在三个服务及数据库运行后手工验收。
