# CampusAgent AI Service

当前包含 FastAPI 基础设施和第一阶段知识库文档处理能力：PDF 文本提取、清洗、切块、Embedding 和 Chroma 向量持久化。检索、Rerank、OCR 和 LLM 不在本阶段范围内。

## 启动

```bash
python -m venv .venv
python -m pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：`GET /internal/v1/health`。

首次处理文档时，Sentence Transformers 会下载 `AI_EMBEDDING_MODEL_NAME` 指定的模型。生产环境应提前缓存模型，或将配置指向本地模型目录。

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

当前仅支持含文本层的 PDF。扫描版 PDF 会返回 `DOCUMENT_HAS_NO_TEXT`，需要在后续阶段接入 OCR。

## 模块边界

- `app/services/document_service.py`：仅编排处理流程；
- `app/services/chunk_service.py`：可替换的切块策略；
- `app/services/embedding_service.py`：模型无关的 Embedding 抽象；
- `app/vector_store/base.py`：向量存储抽象；
- `app/infrastructure/`、`app/vector_store/chroma_store.py`：第三方库适配器；
- `app/core/dependencies.py`：集中组装具体实现。

业务层不直接依赖 Sentence Transformers 或 Chroma。后续接入 Qdrant 时，实现新的 `VectorStore` 并在组合根替换装配即可。

## 测试

```bash
python -m pip install -r requirements-dev.txt
python -m pytest
```
