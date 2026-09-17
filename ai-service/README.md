# CampusAgent AI Service

当前只包含 FastAPI 基础配置、统一响应结构、统一异常响应和健康检查，不包含解析、Embedding、检索、Rerank 或 LLM 实现。

## 启动

```bash
python -m venv .venv
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：`GET /internal/v1/health`。

