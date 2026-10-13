# CampusAgent AI Service

Python 服务提供文档处理、知识检索、RAG 问答和可选办事 AI 辅助，不访问业务 MySQL。Java 保存文件和业务记录，通过内部 HTTP 调用本服务。解析器、Embedding、重排、向量库和 LLM 分别隔离，具体装配集中在 [dependencies.py](app/core/dependencies.py)。

## 安装与启动

以下命令在 ai-service 目录执行，使用 Python 3.12：

```powershell
if (!(Test-Path .venv/Scripts/python.exe)) { py -3.12 -m venv .venv }
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (!(Test-Path .env)) { Copy-Item .env.example .env }
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Python 不需要先激活环境，使用明确的虚拟环境解释器即可。Linux/macOS 使用 `python3 -m venv .venv`、`.venv/bin/python -m pip install -r requirements.txt` 和 `.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`；该平台安装和端到端运行本次未验证。

依赖锁定在 [requirements.txt](requirements.txt)，开发依赖在 [requirements-dev.txt](requirements-dev.txt)。本次不推断其他 Python 版本的 wheel 兼容性。默认 PaddlePaddle 是 CPU 包；GPU 依赖与目标驱动适配仍需另行确认。

健康接口为 `GET /internal/v1/health`，OpenAPI 界面为 `/docs`，Schema 为 `/openapi.json`。健康接口只返回进程状态。Embedding、CrossEncoder 和 Paddle 模型懒加载，首次实际调用可能下载并初始化；健康成功不代表模型已准备好。

## 配置来源与内部接口

[config.py](app/core/config.py) 使用 Pydantic Settings，环境变量前缀为 `AI_`，从当前工作目录读取 .env。配置默认值见 [.env.example](.env.example)。`AI_HOST`、`AI_PORT` 是 Settings 字段，当前 main.py 没有调用 uvicorn.run 使用它们；监听地址由启动命令的 --host/--port 决定。接口前缀由 `AI_API_V1_PREFIX` 决定，默认 /internal/v1。

| 方法 | 默认路径 | 请求和行为 |
| --- | --- | --- |
| GET | /internal/v1/health | 进程健康 |
| POST | /internal/v1/documents/process | multipart：documentId、knowledgeBaseId、file；等待处理完成后响应 |
| GET | /internal/v1/documents/{id}/progress | 进程内处理阶段、页数、百分比和 OCR Provider |
| PATCH | /internal/v1/documents/{id}/name | JSON `{"fileName":"新名称.pdf"}`，更新 Chroma file_name/source |
| DELETE | /internal/v1/documents/{id}/vectors | 清除该文档全部向量并返回数量 |
| POST | /internal/v1/knowledge/search | query、可选 topK/knowledgeBaseId |
| POST | /internal/v1/rag/chat | query、可选 knowledgeBaseId/history |
| POST | /internal/v1/service-guide/recognize | query 和 Java 传入的启用事项目录 candidates |
| POST | /internal/v1/service-guide/narrate | query、可选 knowledgeBaseId 和 guide |

普通 JSON 使用 code/message/data/requestId/timestamp 包装，timestamp 使用 +08:00。FastAPI 为每次请求独立生成 UUID 和 X-Request-Id，不是跨 Java、Python、聊天请求的统一 trace。

当前内部接口没有身份验证。开发时绑定回环；对外部署需限制网络可达范围，不能以 internal 路径代替权限。直接调用 process 只写向量，不创建 Java 文档记录或原文件；日常维护应使用管理员页面，避免两侧数据失配。

## 文档提取与入库

```text
Java 保存原文件和元数据
  → Python ParserRegistry 类型/MIME/内容校验
  → 文本或按需 OCR
  → TextCleaner
  → BoundaryAwareChunkService
  → SentenceTransformerEmbeddingService
  → Chroma.replace_document
  → Java 保存最终状态
```

| 格式 | 当前解析方式和引用页码 |
| --- | --- |
| PDF | pypdf 按页读取文本层，低文本页由 PDFium 渲染/OCR，保留一基页码；受保护且不能空密码解密的 PDF 不支持 |
| DOCX | OOXML 段落及表格中的文字，按 XML 顺序；pageNumber=null，不做 Word 渲染或图片 OCR |
| TXT / MD | UTF-8，MD 去除部分语法，提取正文；无固定页码 |
| XLSX | 按工作表提取缓存单元格值、首个非空行作表头；不重算公式，无固定页码 |
| PPTX | 按 slide 数字顺序提取文字，pageNumber 是该顺序编号；不处理嵌入图片 OCR |
| PNG / JPG / JPEG | 整张图片经过 OCRManager，作为一页 |

旧 DOC/XLS/PPT 和任意 ZIP 不属于知识解析白名单。模板与申请材料由 Java 的独立接口保存，不调用这里的入库流程。Java ADMIN_MAX_UPLOAD_SIZE_MB 默认 20，本服务 AI_MAX_PDF_SIZE_MB 默认 20、允许 1–200，虽名称含 PDF，实际限制全部支持格式。

清洗使用 NFKC、统一换行、删除控制字符、压缩空白，保留页序。切块按字符长度，默认 AI_CHUNK_SIZE=800、AI_CHUNK_OVERLAP=100，优先段落/句子边界，并逐页切分；不是 token 切分或完整章节/表格理解。

向量 metadata 保存 document_id、knowledge_base_id、file_name、file_type、chunk_index、source、embedding_model、content_sha256 和可选 page_number。记录 ID 根据知识库、文档和 Chunk 索引生成确定性 UUID。Chroma 默认使用 cosine 集合 campus_documents，持久化路径为 ai-service/var/chroma；相对 AI_VECTOR_STORE_PATH 由代码相对于 AI 服务根目录解析，不相对于任意启动目录。

修改 Embedding 模型或切块参数需重新入库；现有 metadata 虽记模型名称，但没有完整模型 revision/向量兼容性自动检查。replace_document 先删除旧向量，再分批 upsert，写入失败会尝试清理部分向量，不恢复旧成功索引。

## OCR 与进度

PDF 每页清洗后的文本低于 AI_OCR_TEXT_THRESHOLD（默认 50 字符）时才进入 OCR；超过阈值的页不会做区域图片识别。AI_OCR_ENABLED=false 只禁用 PDF 扫描页回退；图片解析器仍调用 OCRManager，不能将该开关写成禁止所有图片 OCR。

| 配置 | 默认值与作用 |
| --- | --- |
| AI_OCR_MODE / AI_OCR_ALLOW_CLOUD | hybrid / true；hybrid 云端优先失败回 Paddle，qwen 云端失败报错，paddle 本地；allow_cloud=false 强制本地 |
| AI_OCR_MAX_CONCURRENCY | 4，PDF 页任务共享进程内信号量；不代表所有格式的统一全局并发限制 |
| AI_OCR_LANGUAGE / AI_OCR_DEVICE | ch / cpu，Paddle 语言及设备 |
| AI_OCR_DPI / AI_OCR_ENABLE_MKLDNN | 200 / false，扫描页渲染及本地引擎选项 |
| AI_OCR_MAX_PAGES_PER_DOCUMENT | 50，只统计 PDF 需要 OCR 的页 |
| AI_QWEN_OCR_ENABLED / AI_QWEN_OCR_MODEL | true / qwen3.5-ocr |
| AI_QWEN_OCR_API_KEY | 空时依次复用 AI_QWEN_API_KEY、进程 DASHSCOPE_API_KEY |
| AI_QWEN_OCR_BASE_URL | 空时复用 AI_QWEN_BASE_URL |
| AI_QWEN_OCR_TIMEOUT / AI_QWEN_OCR_MAX_RETRIES | 120 秒 / 2 次重试；网络错误与部分 429/5xx 有限退避 |

云 OCR 使用 `<base-url>/responses`，发送页面图片的 data URL，不需要公开原文件地址。Key、地域、模型和业务空间对应的可用 endpoint 需按实际账号确认，不能由默认模型名称证明已调用成功。普通聊天使用不同的 /chat/completions 接口。

Paddle 使用懒加载单例和预测锁，当前装配 PP-OCRv6。PDF 严格模式中任一扫描页识别失败会使文档处理失败，避免写入残缺新索引。错误为 OCR_PAGE_LIMIT_EXCEEDED、OCR_FAILED 等；Java 最终可能将它们收敛为通用失败提示。

AI 进度是单进程内存记录，按阶段权重计算百分比，不是实测剩余时间。过期记录在更新时清理，重启会丢失。Java 保存最终状态，处理中从 Python 取进度并限制为最多 99%；前端约每 2 秒轮询。详见 [OCR 升级](../docs/ocr-upgrade.md) 和 [政策进度](../docs/policy-upload-progress.md)。

## 检索、重排与时间证据

```text
Query Embedding
  → Chroma 候选召回
  → CrossEncoder
  → 时间证据角色校验
  → TopK
```

默认模型为 BAAI/bge-small-zh-v1.5 和 BAAI/bge-reranker-base。Embedding 设备 cpu、批大小 32；重排设备 cpu、批大小 8、max_length=512；向量批写 100。模型懒加载且预测使用锁，不能根据参数推断吞吐量。

知识检索默认 TopK=5，最大 20。启用重排时召回候选数为 max(请求 topK, AI_RERANK_CANDIDATE_TOP_K=10)。响应包括原文、文档、页码、Chunk、score、rerankScore、evidenceScore、evidenceText 和 finalScore。score=1-cosine distance；模型原始分数不是答案准确率或百分比。

时间规则识别“时间/什么时候/截止/截至/最晚/期限”等问法，核对原文日期前的短标题与同一行标签。evidenceScore=1 表示时间角色一致，-1 表示活动时间/截止时间冲突，0.25 表示无明确标签的日期，0 表示没有可用证据。

仅候选中存在 1 分证据时，finalScore=rerankScore+0.35×evidenceScore；否则保留模型排序。权重和开关由 AI_RERANK_TEMPORAL_EVIDENCE_WEIGHT、AI_RERANK_TEMPORAL_EVIDENCE_ENABLED 控制。它是文本规则，不计算相对日期，也不负责政策生效/失效判断。

内部调试示例，不写业务 MySQL：

```powershell
$payload = @{ query = '报名截止时间是什么时候？'; topK = 5; knowledgeBaseId = 'campus-default' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/internal/v1/knowledge/search -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($payload))
```

knowledgeBaseId 可省略，此时不限定 Chroma 知识库。当前没有由登录角色控制的多知识库范围，实际授权问题需在 Java 端处理。

## RAG、多轮与失败行为

Java 公共 /api/rag/chat 使用数据库历史；Python 内部 /rag/chat 的 history 是 Java 转发的临时文本，每项 role=user/assistant、content，最多接收 100 条、每条最多 4000 字符。Python 仅取最近 AI_CONVERSATION_MAX_MESSAGES=8 条用于问题改写；Java 自身最多取 8 条，所以增大 Python 上限不能让公共聊天使用更多历史。

```text
本轮问题 + 最近历史 → Query Rewrite（失败回原问题）
→ Retrieval / Rerank / 时间证据
→ 原始分数过滤 → 去重/截断的 Context
→ 本轮原问题 + Context → Qwen → 答案与实际 Context 来源
```

AI_QUERY_REWRITE_ENABLED=true、AI_QUERY_REWRITE_TEMPERATURE=0。改写失败、空文本、超长、多行或异常格式时回原问题。历史助手回答不进入最终生成 Prompt，也不作为政策来源；仍需评测改写是否错误引入主题。

RAG 默认召回 10、最多使用 3 个片段、Context 总预算 6000 字符。过滤要求 rerankScore>=0.015，并在最高合格分数大于 0 时要求达到其 0.4 倍；时间角色冲突的 -1 证据排除。AI_RAG_MIN_RERANK_SCORE、AI_RAG_MIN_RELATIVE_SCORE、AI_RAG_CONTEXT_TOP_K、AI_RAG_MAX_CONTEXT_CHARS 控制这些行为。阈值是默认初值，未知问题的拒答效果需按实际资料评测，不保留旧文档中的未复测分布数值。

没有合格 Context 直接返回“根据当前知识库暂未找到相关信息。”，不调用生成模型。AI_RERANK_ENABLED=false 时普通 /knowledge/search 可用，但 RAG 装配报 RERANK_UNAVAILABLE；有召回内容却完全无重排分数也报该异常，不能写成知识库没资料。

RAG sources 只包含实际进入 Context 的内容，返回原始 score/rerankScore，没有检索接口的 evidenceScore/finalScore。前端最佳引用会在字段存在时优先 finalScore；历史快照删除原始 score/rerankScore，不能保证恢复后仍选择实时回答中相同的最佳引用。

千问配置默认：

```dotenv
AI_LLM_PROVIDER=qwen
AI_QWEN_API_KEY=
AI_QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_QWEN_MODEL=qwen-plus
AI_QWEN_TRUST_ENV=false
AI_LLM_TIMEOUT_SECONDS=30
AI_LLM_TEMPERATURE=0.2
AI_LLM_MAX_TOKENS=1000
```

当前工厂只实现 qwen。trust_env=false 表示 httpx 默认不使用环境代理；需要代理时先确认可用再开启，不修改或打印真实 Key。代码没有普通聊天请求的有界重试、流式输出或本地 LLM。

| 情况 | Python 错误 | Java 问答映射 |
| --- | --- | --- |
| 有 Context 但缺 Key | 503 LLM_NOT_CONFIGURED | 502，保留错误码 |
| 千问超时 | 504 LLM_TIMEOUT | 502，保留错误码 |
| 千问上游/返回内容异常 | 502 LLM_REQUEST_FAILED | 502，保留错误码 |
| 重排/Embedding/向量库不可用 | 503 对应 *_UNAVAILABLE | 502，保留指定错误码 |
| Python 不可达或 Java 等待超时 | 无有效 Python 响应 | 503 AI_SERVICE_UNAVAILABLE |

健康成功、无证据拒答和真实生成成功是不同状态。LLM 仍可能回答错误，目前没有对每个事实句进行自动证据一致性校验。

## 办事 AI 辅助

Java 先决定事项与查询意图。语义识别只允许返回当前 candidates 中的编码、置信度至少 0.85 以及四种 queryIntent；缺字段/非法输出/调用失败安全回退。结构化流程来自 Java/MySQL，不由模型创建。

narrate 复用检索与过滤，绑定来源文档时只接受该文档片段。模型最多选择两段、每段 8–240 字符且必须是 Context 连续原文，首步/材料/截止说明由程序组装。示例事项不借用真实政策。Provider 异常由 Java 返回数据库指南。

aiEnhanced=true 表示 AI 辅助调用返回有效结果，不证明有新增引用、答案质量提升或实际完成办理。事项识别主要看当前问题，没有持续的多轮事项状态机。详见 [引导说明](../docs/service-guide-v1.md)。

## 测试与模块位置

```powershell
# ai-service 目录
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q --basetemp ../tmp/pytest-campus
.\.venv\Scripts\python.exe -m pytest tests/unit/test_temporal_evidence_rerank.py -q --basetemp ../tmp/pytest-temporal
```

模型/云 API 测试多数使用替身，Chroma 集成测试使用临时目录。真实云 OCR、学校语料问答、性能和环境安装需另行验收。本次实际结果见 [文档索引](../docs/README.md)。

文档编排在 app/services/document_service.py，解析注册在 document_parsers.py，OCR 选择在 app/infrastructure/ocr/，检索与证据规则在 app/services/，Provider 在 app/llm/，Chroma 在 app/vector_store/。后续接入其他向量库需实现抽象并更改装配；目前没有 FAISS、Qdrant、关键词混合检索或政策版本过滤实现。
