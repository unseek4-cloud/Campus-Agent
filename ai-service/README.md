# CampusAgent AI Service

包含知识库入库、检索和 RAG 问答能力：普通/扫描 PDF 和 DOCX 文本提取、清洗、切块、Embedding、Chroma 向量持久化、TopK 相似度召回、本地 CrossEncoder 重排和千问答案生成。扫描页优先使用 Qwen OCR，失败时由 PaddleOCR 在本地继续处理。

## 启动

```powershell
python -m venv .venv
python -m pip install -r requirements.txt
if (!(Test-Path .env)) { Copy-Item .env.example .env }
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：`GET /internal/v1/health`。

所有业务 JSON 响应中的 `timestamp` 统一使用 UTC+8，并携带明确的 `+08:00` 偏移量。HTTP `Date` 响应头按协议规范继续使用 GMT。

首次处理文档时，Sentence Transformers 会下载 `AI_EMBEDDING_MODEL_NAME` 指定的模型。首次执行检索时会延迟加载 `AI_RERANK_MODEL_NAME` 指定的 CrossEncoder。首次实际使用本地 OCR 时，PaddleOCR 会下载并缓存模型。生产环境若需本地兜底，应提前缓存模型。

## 文档处理接口

内部接口：`POST /internal/v1/documents/process`，请求类型为 `multipart/form-data`。

字段：

- `documentId`：Java 后端管理的文档 ID；
- `knowledgeBaseId`：Java 后端管理的知识库 ID；
- `file`：PDF、DOCX、TXT、Markdown、XLSX、PPTX 或图片文件。
- 管理员端另支持 TXT、Markdown、XLSX、PPTX、PNG、JPG/JPEG；同一内部接口处理，Java 负责元数据、去重和原文件持久化。

PowerShell 示例：

```powershell
curl.exe -X POST http://localhost:8000/internal/v1/documents/process `
  -F "documentId=doc-001" `
  -F "knowledgeBaseId=kb-001" `
  -F "file=@rules.pdf;type=application/pdf"
```

Chroma 默认持久化到 `var/chroma`。该目录是运行时数据，不应提交到 Git。

DOCX 会保留段落和表格文字顺序。DOCX 文件本身没有稳定的渲染页码，因此其
chunk metadata 和检索结果中的 `pageNumber` 为 `null`，不会伪造页码。

其他格式使用 `ParserRegistry` 选择解析器：TXT/Markdown 解码 UTF-8，XLSX 保留工作表和表头，PPTX 按幻灯片保留页码，图片使用同一 OCRManager。扩展名、MIME 与文件签名共同校验；旧版 Office 和未知二进制文件被拒绝。解析后全部复用现有清洗、切片、批量 Embedding 和 Chroma 流程。管理员重命名会调用 `PATCH /internal/v1/documents/{id}/name` 更新 Chroma 引用元数据；删除继续使用原有向量删除接口。`GET /internal/v1/documents/{id}/progress` 返回当前处理阶段和页数，进度保存在 AI 服务单进程内存中。

## 知识库检索接口

内部接口：`POST /internal/v1/knowledge/search`。

```json
{
  "query": "国家奖学金申请需要满足什么条件？",
  "topK": 5,
  "knowledgeBaseId": "kb-001"
}
```

`knowledgeBaseId` 可选；传入时只检索该知识库。开启 Rerank 时，时间类问题会在模型分数后
核对日期证据的语义角色（例如“调查时间”和“截止时间”），按 `finalScore` 排序。
其他问题仍按模型 `rerankScore` 排序。响应包含原始 cosine `score`、模型原始
`rerankScore`、`evidenceScore`、`evidenceText`、`finalScore`、chunk 原文、
文件名、文件类型、页码、`chunkIndex`、
`documentId` 和来源。Chroma 使用 cosine 空间，接口将距离转换为
`score = 1 - distance`；关闭 Rerank 时新增分数字段为 `null`。

检索数据流：

```text
Query → Embedding → Chroma candidates (default 10)
      → CrossEncoder Reranker → 时间证据校验 → final TopK (default 5)
```

PowerShell 示例：

```powershell
$body = @{ query = "国家奖学金申请需要满足什么条件？"; topK = 5 } |
  ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri http://localhost:8000/internal/v1/knowledge/search `
  -ContentType "application/json" `
  -Body $body
```

删除某个文档的全部向量：

```powershell
Invoke-RestMethod -Method Delete `
  -Uri http://localhost:8000/internal/v1/documents/doc-001/vectors
```

## RAG 问答接口与配置

内部接口：`POST /internal/v1/rag/chat`。旧检索接口仍可单独调用。

```json
{"query":"2026级新生心理测评时间是什么时候？","knowledgeBaseId":"kb-001"}
```

`knowledgeBaseId` 可省略。响应沿用 `code/message/data/requestId/timestamp` 包装；`data` 包含 `answer`、`sources`、`retrievalCount`、`rerankCount`、`usedContextCount`、`rewrittenQuery`。来源只取实际送入模型的片段，`content` 是送入模型的实际文字；前端以已有的 `documentId:chunkIndex` 显示 Chunk ID。

多轮请求可附带可选 `history`，每项只含 `role`（`user` / `assistant`）和 `content`。例如：

```json
{
  "query": "对象是谁？",
  "history": [
    { "role": "user", "content": "2026级新生心理测评什么时候？" },
    { "role": "assistant", "content": "2026年9月19日至22日。" }
  ]
}
```

这是无状态会话：浏览器维护历史，Java 校验后转发，Python 只取最近 `AI_CONVERSATION_MAX_MESSAGES` 条用于 Query Rewrite。改写器复用现有 LLM Provider；改写结果仅用于 Retrieval 和 Rerank。最终回答 Prompt 仍只含用户本轮原问题及本次知识库 Context，历史回答不作为事实来源，`sources` 仍只来自本次 Context。无历史时完全跳过改写；Provider 超时、异常、空值或异常格式时回退原问题并继续现有 RAG。`rewrittenQuery` 为调试字段，不含完整 Prompt。

处理流程：候选召回 → 现有 Rerank 和时间证据排序 → 原始模型分数过滤 → 最多 3 个 Chunk → 去重和长度限制 → 千问 OpenAI Compatible `/chat/completions` → 答案与来源。日期证据角色明确冲突的片段不会进入 Context。没有片段达到阈值时直接返回“根据当前知识库暂未找到相关信息。”，不调用千问。

在 `ai-service/.env` 中配置（先复制 `.env.example`）：

```dotenv
AI_LLM_PROVIDER=qwen
AI_QWEN_API_KEY=你的百炼 API Key
AI_QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_QWEN_MODEL=qwen-plus
AI_QWEN_TRUST_ENV=false
AI_LLM_TIMEOUT_SECONDS=30
AI_LLM_TEMPERATURE=0.2
AI_LLM_MAX_TOKENS=1000
AI_RAG_RETRIEVAL_TOP_K=10
AI_RAG_CONTEXT_TOP_K=3
AI_RAG_MIN_RERANK_SCORE=0.015
AI_RAG_MIN_RELATIVE_SCORE=0.4
AI_RAG_MAX_CONTEXT_CHARS=6000
AI_CONVERSATION_MAX_MESSAGES=8
AI_QUERY_REWRITE_ENABLED=true
AI_QUERY_REWRITE_TEMPERATURE=0
```

`.env` 已被 Git 忽略。没有 API Key 时，检索仍可用；有 Context 的 RAG 请求返回 `LLM_NOT_CONFIGURED`。超时返回 `LLM_TIMEOUT`，上游报错或空内容返回 `LLM_REQUEST_FAILED`。Python 不可用时，Java 返回 `AI_SERVICE_UNAVAILABLE`。

`AI_QWEN_TRUST_ENV=false` 使千问 HTTP 客户端默认直连，避免 Windows 系统中失效的本地代理导致连接超时。若所在网络必须经环境变量或系统代理访问千问，可设置为 `true`，并先确认代理本身可连接。若看到 `Qwen API connection failed` 或 `Qwen request timed out`，先检查千问域名连通性和代理；若返回 `Qwen API returned HTTP 401/403`，再检查 Key、地域和权限。修改此配置后需重启 AI 服务。无需改动真实 `.env` 中已有的 Key。

`AI_QWEN_BASE_URL` 默认示例适用于北京地域的兼容接口。其他地域或业务空间专属域名请按[阿里云百炼 OpenAI 兼容接口文档](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)填写，Key 与地域需匹配。

`AI_RAG_MIN_RERANK_SCORE` 是 **CrossEncoder 原始分数**，不是百分比；`finalScore` 只决定排序。`AI_RAG_MIN_RELATIVE_SCORE` 要求候选原始分数至少达到本次最高分的相应比例（仅当最高分大于 0 时应用）。分数范围随模型和资料变化。对当前本地索引做离线抽样：时间问题正确片段约 `0.994`，无关片段约 `0.065`；对象问题相关通知片段约 `0.018`；一个未知问题最高约 `0.014`。因此默认绝对阈值 `0.015`、相对比例 `0.4` 只是当前资料的初值，不能保证其他未知问题均被拦截。先用旧 `/knowledge/search` 接口测试可回答和不可回答的问题，查看 `rerankScore` 分布，再调整阈值：误拒有效片段则降低，无关片段进入 Context 则提高。关闭 `AI_RERANK_ENABLED` 时没有 `rerankScore`，RAG 会拒绝全部片段以避免无依据回答。

PowerShell 调用示例：

```powershell
$body = @{ query = "2026级新生心理测评时间是什么时候？" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:8000/internal/v1/rag/chat -ContentType "application/json" -Body $body
```

## PDF 与 OCR 处理流程

每一页都会优先使用 pypdf 读取已有文本层：

```text
PDF
  → pypdf 按页提取
  → 有可用文本：直接保留
  → 有效文本不足阈值：仅渲染该页并执行 Qwen OCR；异常时回退 PaddleOCR
  → 合并全部页面，并保留原始页码
  → TextCleaner → ChunkService → EmbeddingService → Chroma
```

普通文字型 PDF 不会触发页面渲染或 OCR，也不会加载 PaddleOCR 模型。混合 PDF 只 OCR 文本不足阈值的页面。页面任务最多并发 `AI_OCR_MAX_CONCURRENCY` 个，按原页码合并。PaddleOCR 仍以懒加载单例和推理锁复用。实际入库流程中若两种引擎都失败，整份文档标记失败并清理向量，避免留下残缺知识库。

为避免超大扫描文件消耗过多 CPU 和内存，需要 OCR 的页面数超过 `AI_OCR_MAX_PAGES_PER_DOCUMENT` 时会在写入向量前返回 `OCR_PAGE_LIMIT_EXCEEDED`，不会创建残缺索引。

### OCR 配置

```dotenv
AI_OCR_ENABLED=true
AI_OCR_LANGUAGE=ch
AI_OCR_DPI=200
AI_OCR_DEVICE=cpu
AI_OCR_ENABLE_MKLDNN=false
AI_OCR_MAX_PAGES_PER_DOCUMENT=50
AI_OCR_MODE=hybrid
AI_OCR_ALLOW_CLOUD=true
AI_OCR_MAX_CONCURRENCY=4
AI_OCR_TEXT_THRESHOLD=50
AI_QWEN_OCR_ENABLED=true
AI_QWEN_OCR_MODEL=qwen3.5-ocr
AI_QWEN_OCR_API_KEY=
AI_QWEN_OCR_BASE_URL=
AI_QWEN_OCR_TIMEOUT=120
AI_QWEN_OCR_MAX_RETRIES=2
```

- `AI_OCR_ENABLED`：是否允许扫描页 OCR；关闭后仍可处理普通文字 PDF；
- `AI_OCR_LANGUAGE`：PaddleOCR 语言，校园中文资料建议使用 `ch`，可识别常见中英文混排；
- `AI_OCR_DPI`：扫描页渲染分辨率，默认 200；
- `AI_OCR_DEVICE`：`cpu`、`gpu` 或 `gpu:0` 等设备标识；
- `AI_OCR_ENABLE_MKLDNN`：是否启用 oneDNN/MKL-DNN CPU 加速；Windows 下 PP-OCRv6 与部分 PaddlePaddle 版本存在兼容问题，默认关闭；
- `AI_OCR_MAX_PAGES_PER_DOCUMENT`：单个文档允许执行 OCR 的最大页数，只统计没有可用文本的页面。
- `AI_OCR_MODE`：`hybrid` 云端优先并本地回退、`qwen` 仅云端、`paddle` 仅本地；
- `AI_OCR_ALLOW_CLOUD=false`：覆盖模式并强制本地识别，不发送文件到云端；
- `AI_OCR_MAX_CONCURRENCY`：扫描页并发上限，默认 4，跨文档也受共享信号量限制；
- `AI_OCR_TEXT_THRESHOLD`：文本层低于该字符数才 OCR，默认 50；
- `AI_QWEN_OCR_*`：独立 OCR 模型、Key、地址、请求超时和重试次数。Key 留空时依次复用 `AI_QWEN_API_KEY`、进程环境中的 `DASHSCOPE_API_KEY`；未配置时混合模式转 PaddleOCR。

Qwen OCR 调用使用阿里云 [Responses API 的图片输入](https://help.aliyun.com/en/model-studio/qwen-vl-ocr)。该模型也支持通过 `file_url` 解析 PDF，但管理员上传的学校资料默认没有公网地址；本项目按页渲染并发送图片，既能只 OCR 扫描页，也无需公开原文件。使用 `qwen3.5-ocr` 时，请把 `AI_QWEN_OCR_BASE_URL` 配成与你的 Key 地域一致的百炼业务空间兼容接口地址，例如 `https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。无需新增 Python 依赖，现有 `httpx` 已用于请求。

### Windows 依赖

默认安装的是 PaddlePaddle CPU 版。使用 64 位 Python 3.11–3.13 和官方 wheel 时，不需要另外安装 Tesseract、Poppler 或 Ghostscript。当前开发环境已在 Windows、Python 3.12 上验证。PDF 页面由 pypdfium2 渲染。

CPU 下本地 OCR 可能较慢，尤其是长文档。需要使用 NVIDIA GPU 时，应根据 PaddlePaddle 官方安装说明卸载 CPU 包 `paddlepaddle`，安装与驱动匹配的 `paddlepaddle-gpu`，然后把 `AI_OCR_DEVICE` 改为 `gpu:0`。不要同时安装 CPU 和 GPU 两个 PaddlePaddle 包。

PaddleOCR 模型采用延迟初始化：FastAPI 启动、健康检查和处理普通文字 PDF 时都不会加载模型。第一次真正处理扫描页时下载和初始化可能需要较长时间。

Embedding 模型同样采用延迟初始化。依赖装配使用进程内缓存，入库和检索共享同
一个 Embedding 实例与 Chroma 实例，不会在每次上传或每次查询时重新加载模型。

### Chunk、Embedding 与检索配置

```dotenv
AI_CHUNK_SIZE=800
AI_CHUNK_OVERLAP=100
AI_EMBEDDING_MODEL_NAME=BAAI/bge-small-zh-v1.5
AI_EMBEDDING_DEVICE=cpu
AI_EMBEDDING_BATCH_SIZE=32
AI_VECTOR_STORE_PATH=var/chroma
AI_VECTOR_STORE_COLLECTION=campus_documents
AI_RETRIEVAL_DEFAULT_TOP_K=5
AI_RETRIEVAL_MAX_TOP_K=20
AI_RERANK_ENABLED=true
AI_RERANK_MODEL_NAME=BAAI/bge-reranker-base
AI_RERANK_DEVICE=cpu
AI_RERANK_BATCH_SIZE=8
AI_RERANK_MAX_LENGTH=512
AI_RERANK_CANDIDATE_TOP_K=10
AI_RERANK_TEMPORAL_EVIDENCE_ENABLED=true
AI_RERANK_TEMPORAL_EVIDENCE_WEIGHT=0.35
```

修改 Embedding 模型后，旧向量与新查询向量不再属于同一向量空间，应删除并重新
处理已有文档。修改 Chunk 参数也需要重新处理文档才能更新已有索引。

Rerank 只作用于查询时的候选排序，修改 Rerank 模型或关闭
`AI_RERANK_ENABLED` 不需要重新入库。`AI_RERANK_CANDIDATE_TOP_K`
控制开启重排时 Chroma 的默认候选数；若请求 `topK` 更大，候选数会
自动提升到请求值，以保证返回数量。
时间证据校验仅作用于时间类问题，`evidenceScore` 为 `1` 时表示候选日期的角色
与问法吻合，`-1` 表示“调查时间”与“截止时间”等角色冲突，`0.25` 表示有日期
但没有明确时间标签，`0` 表示没有可用证据。
`finalScore = rerankScore + AI_RERANK_TEMPORAL_EVIDENCE_WEIGHT × evidenceScore`；
`rerankScore` 始终保留模型原值。`evidenceText` 是来源 chunk 的原文摘录，不是 LLM 生成答案。
只有候选中出现明确的同类时间证据（`evidenceScore = 1`）时才启用证据加权；
否则保持模型原排序，但仍返回发现的冲突证据供检查。
关闭 `AI_RERANK_TEMPORAL_EVIDENCE_ENABLED` 可恢复纯模型重排。

## 模块边界

- `app/services/document_service.py`：仅编排处理流程；
- `app/services/ocr_fallback_document_extractor.py`：编排“文本优先、逐页 OCR 回退”策略；
- `app/services/ocr_service.py`：OCR 引擎抽象；
- `app/services/pdf_page_renderer.py`：PDF 页面渲染抽象；
- `app/services/chunk_service.py`：可替换的切块策略；
- `app/services/embedding_service.py`：模型无关的 Embedding 抽象；
- `app/services/rerank_service.py`：模型无关的 Rerank 抽象；
- `app/services/temporal_evidence_service.py`：从候选原文核对时间证据；
- `app/services/evidence_aware_rerank_service.py`：组合模型分数与时间证据；
- `app/services/retrieval_service.py`：只编排 query embedding、候选召回与独立重排服务；
- `app/services/result_filter.py`：根据原始 Rerank 分数筛选 Chunk；
- `app/services/context_builder.py`：去重、截断并保留实际引用来源；
- `app/services/rag_service.py`：编排检索、过滤、Context 与 LLM；
- `app/llm/`：模型 Provider 抽象、千问适配器、工厂和 Prompt；
- `app/vector_store/base.py`：向量存储抽象；
- `app/infrastructure/`、`app/vector_store/chroma_store.py`：第三方库适配器；
- `app/core/dependencies.py`：集中组装具体实现。

业务层不直接依赖 PaddleOCR、PDFium、Sentence Transformers 或 Chroma。后续更换 OCR 引擎、PDF 渲染库或接入 Qdrant 时，实现对应抽象并在组合根替换装配即可。

## 测试

```bash
python -m pip install -r requirements-dev.txt
python -m pytest
```

只运行“心理测评时间”重排回归测试：

```bash
python -m pytest tests/unit/test_retrieval_service.py \
  -k psychological_assessment_time
python -m pytest tests/unit/test_temporal_evidence_rerank.py
```

服务启动且目标文档已入库后，可用真实模型验收：

```powershell
$body = @{ query = "心理测评的时间是什么时候？"; topK = 5 } |
  ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri http://localhost:8000/internal/v1/knowledge/search `
  -ContentType "application/json" `
  -Body $body
```

验收时检查 `results[0]`：内容应包含 `2026年9月19日—22日`，
`pageNumber` 应为 `1`，`evidenceText` 应定位到“调查时间”和日期，
`score` 与 `rerankScore` 分别保留原始 cosine 与模型分数，最终顺序由
`finalScore` 决定。若问“心理测评截止时间是什么时候？”，则应由 page 4 排第一。

### RAG 验收问题

目标心理测评通知入库后，依次向 Java 的 `POST /api/rag/chat` 或本服务的 `POST /internal/v1/rag/chat` 提问：

1. `2026级新生心理测评时间是什么时候？`：当前本地通知应只回答通知中的调查时间 `2026年9月19日—22日`，不要附带对象、登录方式、电话；
2. `心理测评对象是谁？`：只回答通知中列出的对象，核对引用文字，避免把截图界面当成对象来源；
3. `心理测评在哪里进行？`：只根据通知中的地点或平台信息回答，不推断通知未写出的实体地点；
4. `校园火星基地怎么申请？`：当前本地知识库应返回固定的“根据当前知识库暂未找到相关信息。”，`sources` 为空、`usedContextCount` 为 0。

衡量无关回答是否改善：同时用旧检索 API 查看同一问题的 Top 10，再检查 RAG 的 `usedContextCount` 和 `sources`。当前本地索引中，时间问题从 10 个重排候选缩减到 1 个上下文片段；对象和地点各缩减到 3 个。最终答案只应包含所问字段。LLM 答案的语义质量仍需配置真实千问 Key 后人工复核；自动测试使用替身 Provider，不会消费 API 额度。
