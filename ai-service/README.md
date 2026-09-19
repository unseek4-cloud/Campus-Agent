# CampusAgent AI Service

当前包含完整的知识库入库与检索能力：普通/扫描 PDF 和 DOCX 文本提取、清洗、切块、Embedding、Chroma 向量持久化、TopK 相似度召回及本地 CrossEncoder 重排。扫描页通过 PaddleOCR 在本地完成中英文 OCR；本阶段不生成 LLM 最终回答。

## 启动

```bash
python -m venv .venv
python -m pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：`GET /internal/v1/health`。

所有业务 JSON 响应中的 `timestamp` 统一使用 UTC+8，并携带明确的 `+08:00` 偏移量。HTTP `Date` 响应头按协议规范继续使用 GMT。

首次处理文档时，Sentence Transformers 会下载 `AI_EMBEDDING_MODEL_NAME` 指定的模型。首次执行检索时会延迟加载 `AI_RERANK_MODEL_NAME` 指定的 CrossEncoder。首次遇到需要 OCR 的扫描页时，PaddleOCR 也会下载 OCR 模型。生产环境应提前缓存模型，并保证运行环境能访问模型下载源。

## 文档处理接口

内部接口：`POST /internal/v1/documents/process`，请求类型为 `multipart/form-data`。

字段：

- `documentId`：Java 后端管理的文档 ID；
- `knowledgeBaseId`：Java 后端管理的知识库 ID；
- `file`：PDF 或 DOCX 文件。

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

## PDF 与 OCR 处理流程

每一页都会优先使用 pypdf 读取已有文本层：

```text
PDF
  → pypdf 按页提取
  → 有可用文本：直接保留
  → 无可用文本：仅渲染该页并执行 PaddleOCR
  → 合并全部页面，并保留原始页码
  → TextCleaner → ChunkService → EmbeddingService → Chroma
```

普通文字型 PDF 不会触发页面渲染或 OCR，也不会加载 PaddleOCR 模型。混合 PDF 只 OCR 无文字的页面。单页渲染或 OCR 失败不会中断其他页面；只有最终所有页面都没有可用文本时，接口才返回 `DOCUMENT_HAS_NO_TEXT`。

为避免超大扫描文件消耗过多 CPU 和内存，需要 OCR 的页面数超过 `AI_OCR_MAX_PAGES_PER_DOCUMENT` 时会在写入向量前返回 `OCR_PAGE_LIMIT_EXCEEDED`，不会创建残缺索引。

### OCR 配置

```dotenv
AI_OCR_ENABLED=true
AI_OCR_LANGUAGE=ch
AI_OCR_DPI=300
AI_OCR_DEVICE=cpu
AI_OCR_ENABLE_MKLDNN=false
AI_OCR_MAX_PAGES_PER_DOCUMENT=50
```

- `AI_OCR_ENABLED`：是否允许扫描页 OCR；关闭后仍可处理普通文字 PDF；
- `AI_OCR_LANGUAGE`：PaddleOCR 语言，校园中文资料建议使用 `ch`，可识别常见中英文混排；
- `AI_OCR_DPI`：扫描页渲染分辨率，默认 300；降低到 200 可减少 CPU 和内存消耗；
- `AI_OCR_DEVICE`：`cpu`、`gpu` 或 `gpu:0` 等设备标识；
- `AI_OCR_ENABLE_MKLDNN`：是否启用 oneDNN/MKL-DNN CPU 加速；Windows 下 PP-OCRv6 与部分 PaddlePaddle 版本存在兼容问题，默认关闭；
- `AI_OCR_MAX_PAGES_PER_DOCUMENT`：单个文档允许执行 OCR 的最大页数，只统计没有可用文本的页面。

### Windows 依赖

默认安装的是 PaddlePaddle CPU 版。使用 64 位 Python 3.11–3.13 和官方 wheel 时，不需要另外安装 Tesseract、Poppler 或 Ghostscript。当前开发环境已在 Windows、Python 3.12 上验证。PDF 页面由 pypdfium2 渲染。

CPU 下 OCR 可能较慢，尤其是 300 DPI 的长文档。需要使用 NVIDIA GPU 时，应根据 PaddlePaddle 官方安装说明卸载 CPU 包 `paddlepaddle`，安装与驱动匹配的 `paddlepaddle-gpu`，然后把 `AI_OCR_DEVICE` 改为 `gpu:0`。不要同时安装 CPU 和 GPU 两个 PaddlePaddle 包。

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
