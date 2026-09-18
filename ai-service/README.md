# CampusAgent AI Service

当前包含 FastAPI 基础设施和第一阶段知识库文档处理能力：普通/扫描 PDF 文本提取、清洗、切块、Embedding 和 Chroma 向量持久化。扫描页通过 PaddleOCR 在本地完成中英文 OCR；检索、Rerank 和 LLM 不在本阶段范围内。

## 启动

```bash
python -m venv .venv
python -m pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：`GET /internal/v1/health`。

所有业务 JSON 响应中的 `timestamp` 统一使用 UTC+8，并携带明确的 `+08:00` 偏移量。HTTP `Date` 响应头按协议规范继续使用 GMT。

首次处理文档时，Sentence Transformers 会下载 `AI_EMBEDDING_MODEL_NAME` 指定的模型。首次遇到需要 OCR 的扫描页时，PaddleOCR 也会下载 OCR 模型。生产环境应提前缓存模型，并保证运行环境能访问模型下载源。

## 文档处理接口

内部接口：`POST /internal/v1/documents/process`，请求类型为 `multipart/form-data`。

字段：

- `documentId`：Java 后端管理的文档 ID；
- `knowledgeBaseId`：Java 后端管理的知识库 ID；
- `file`：PDF 文件。

PowerShell 示例：

```powershell
curl.exe -X POST http://localhost:8000/internal/v1/documents/process `
  -F "documentId=doc-001" `
  -F "knowledgeBaseId=kb-001" `
  -F "file=@rules.pdf;type=application/pdf"
```

Chroma 默认持久化到 `var/chroma`。该目录是运行时数据，不应提交到 Git。

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

## 模块边界

- `app/services/document_service.py`：仅编排处理流程；
- `app/services/ocr_fallback_document_extractor.py`：编排“文本优先、逐页 OCR 回退”策略；
- `app/services/ocr_service.py`：OCR 引擎抽象；
- `app/services/pdf_page_renderer.py`：PDF 页面渲染抽象；
- `app/services/chunk_service.py`：可替换的切块策略；
- `app/services/embedding_service.py`：模型无关的 Embedding 抽象；
- `app/vector_store/base.py`：向量存储抽象；
- `app/infrastructure/`、`app/vector_store/chroma_store.py`：第三方库适配器；
- `app/core/dependencies.py`：集中组装具体实现。

业务层不直接依赖 PaddleOCR、PDFium、Sentence Transformers 或 Chroma。后续更换 OCR 引擎、PDF 渲染库或接入 Qdrant 时，实现对应抽象并在组合根替换装配即可。

## 测试

```bash
python -m pip install -r requirements-dev.txt
python -m pytest
```
