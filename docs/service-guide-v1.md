# 智能办事流程引导 V1：开发与验收说明

## 1. 本次功能

完成“问题 → 事项识别 → MySQL 事项/步骤 → 可选 AI 补充 → 结构化卡片”的完整链路，继续使用原 `POST /api/rag/chat`。普通问题返回 `type=QA`，办事问题返回 `type=SERVICE_GUIDE`；原 answer、sources、检索统计、rewrittenQuery 字段均保留。

学生端包含部门、地点、办公时间、联系方式、条件、材料清单、步骤时间线和来源。材料可勾选，状态只保留在当前页面；`currentStep=1` 表示默认首步，无步骤时为 0，不宣称用户完成了审批。

管理员 `/admin/services` 支持查看、新增、编辑、删除、草稿/启用/停用、材料维护、步骤新增删除与上下排序、来源关联和识别词配置。事项和步骤在同一事务保存；version 防止旧页面覆盖新修改。V1 编辑会重建步骤行，后续永久用户进度需要改为保留稳定 stepId。

## 2. 架构与数据流

```text
Vue → POST /api/rag/chat → ChatService → 沿用 RagService.normalize 校验
  → ServiceIntentRecognizer
      → ACTIVE 事项目录：数据库主题词 + 动作词 + 排除词组合
      → 模糊办理意图：Python → 既有千问 Provider → 限定目录编码/置信度校验
  ├─ unmatched → 原 RagService → 原 Query Rewrite / Retrieval / Rerank / LLM
  └─ matched → ServiceGuideService → service_item + service_step
      → Python 办事说明：可选 Retrieval / Rerank / Context + LLM 选择原文证据
      → 数据库首步说明 + 校验后的补充原文
      → SERVICE_GUIDE + service + steps + source + currentStep
```

`campus-affair` 拥有事项数据、管理服务和规则，公开 DTO、目录服务和 SemanticIntentMatcher 接口；`campus-ai-integration` 实现 AI 适配器并编排聊天。不跨模块读取事项 Repository 或表。来源文件下载在 `campus-app` 组合两个模块的公开 Service。

明确命中不调用 LLM 分类。规则支持包含匹配、标点/空白归一化和同义词组合，不依赖整句完全匹配；业务编码和词表在 SQL/数据库维护。模型只能返回当前启用目录内的编码，置信度至少 0.85。规则返回的 0.93 是命中评分，不是统计校准概率。

多个事项、否定办理、模糊或 AI 失败返回 unmatched。时间、地点等普通问题通过动作边界和排除词保留 RAG，心理测评示例已配置相关排除词。V1 只对当前问题识别，不根据历史助手回答猜测办事进度；未命中的多轮问答仍交给原 Query Rewrite。

## 3. 数据库与初始化

- **service_item**：唯一 code、分类、部门/地点/时间/联系方式、条件、材料、识别规则、来源、status、is_example、version、创建/更新时间。
- **service_step**：事项外键、顺序、标题、说明、责任部门、所需材料、地点和预计耗时；`(service_item_id, step_order)` 唯一。
- requirements 是 JSON 字符串数组；materials 是 `{name, description, required}` 对象数组；recognition_rules 是 `{subjects, actions, exclusions}` 数组对象；每步材料为 JSON 字符串数组。材料暂无独立查询需求，保留可扩展 JSON；步骤需独立查询、排序，单独建表。
- source_document_id 对齐已有文档 UUID：`VARCHAR(36)`。删除知识库文件时置空 ID，保留事项与来源标题；删除事项级联删除步骤。
- 增加事项编码唯一约束、状态/分类及更新时间索引、来源外键索引、步骤事项/顺序唯一索引；状态和正数步骤顺序有 CHECK 约束。

没有重建数据库，也没有改动原知识库表结构。启动时 Spring SQL 初始化依次执行现有 `schema.sql` 和新增 `db/migration/V3__service_guide.sql`，均可重复运行。既有数据库仍需满足此前 V2 升级要求。项目未引入 Flyway，继续现有 SQL 初始化方案。

五项示例位于 `backend/campus-app/src/main/resources/db/seed/service_guide_examples.sql`：学生证补办、奖学金申请、心理测评、学生请假、宿舍报修，共 25 步。均标记 `is_example=true`，来源明确为测试数据，地点/期限/电话/发布时间留空，不假冒学校政策。学生证补办包含：准备材料、填写申请、辅导员审核、学院审核、学生工作处办理、领取学生证。

示例脚本只需显式导入一次；重复执行不覆盖已有编码的事项及步骤，服务重启不会恢复被管理员删除的示例。在 MySQL 客户端中执行（按实际目录调整）：

```sql
USE campus_agent;
SOURCE D:/AIC_ai-agent/Project/Campus-Agent/backend/campus-app/src/main/resources/db/migration/V3__service_guide.sql;
SOURCE D:/AIC_ai-agent/Project/Campus-Agent/backend/campus-app/src/main/resources/db/seed/service_guide_examples.sql;
```

**本次开发已在当前本地 MySQL 执行迁移与示例导入，验证了重复执行不产生重复记录。** 管理员编辑真实学校数据后应取消“示例数据”标记，填写实际来源，核对条件/材料/步骤。

## 4. API

沿用 `code/message/data/requestId/timestamp` 包装，下表内容描述 data。

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/services` | 所有启用事项 |
| GET | `/api/services/{id}` | `{service, steps}`，不存在或未启用为 404 |
| GET | `/api/services/{id}/steps` | 有序步骤数组 |
| POST | `/api/services/recognize` | `{query}` → matched/serviceCode/serviceName/confidence；未命中仅 matched=false |
| GET | `/api/services/{id}/source` | 下载启用事项绑定的已上传原文件；未关联或文件缺失为 404 |
| GET | `/api/admin/services` | 全部状态事项 |
| GET | `/api/admin/services/{id}` | 管理员详情 `{service, steps}` |
| POST | `/api/admin/services` | 创建 `{service, steps}`，数据库生成 ID |
| PUT | `/api/admin/services/{id}` | 整体保存，携带 service.version；步骤按数组顺序重新编号 |
| DELETE | `/api/admin/services/{id}?version=0` | 版本匹配后删除事项和步骤，保留知识库文档 |
| POST | `/api/rag/chat` | 扩展原接口，返回 QA 或 SERVICE_GUIDE |

新增 Python 内部接口：`/internal/v1/service-guide/recognize`、`/internal/v1/service-guide/narrate`。前端只访问 Java。Java 使用 HTTP/1.1，与原 RAG 客户端一致。

办事响应示意（实际响应还有完整事项字段）：

```json
{
  "type": "SERVICE_GUIDE",
  "answer": "【测试数据 / 示例数据，不代表学校真实政策】你首先应该准备材料……",
  "service": { "id": 1, "name": "学生证补办", "isExample": true, "materials": [] },
  "steps": [{ "order": 1, "title": "准备材料", "requiredMaterials": [] }],
  "source": { "title": "测试数据 / 示例流程（非学校文件）", "documentId": null, "publishTime": null, "url": null },
  "currentStep": 1,
  "aiEnhanced": false,
  "sources": [],
  "retrievalCount": 0,
  "rerankCount": 0,
  "usedContextCount": 0,
  "rewrittenQuery": "我的学生证丢了，应该怎么办？"
}
```

API 目前返回完整事项 DTO，含识别词配置。后续多学校部署应增加学生专用 DTO、事项知识库范围及权限过滤。

## 5. 事实约束、来源与降级

1. 卡片完全取 MySQL，模型不能修改部门、材料、步骤或来源。
2. Prompt 明确禁止编造办理事实；进一步限制模型仅输出 Context 原文和索引。应用检查索引、长度和原文包含关系后才展示。首步说明由数据库确定，模型自由生成的未验证事实不会被展示。
3. RAG 补充复用既有过滤和 Context Builder；若绑定文档，仅接受该文档的片段。引用 metadata 来自实际 Context，不由模型生成。
4. 示例流程不混用真实学校资料，Java 确定性添加示例标识。
5. 缺少截止日期、地点、条件、步骤、来源时显示未维护/未找到提示。
6. AI 超时、未配置 Key、Python 离线等均返回数据库流程和首步提示，`aiEnhanced=false`。默认办事 AI 等待上限 12 秒，配置 `SERVICE_GUIDE_AI_TIMEOUT_SECONDS`；原 RAG 超时保持原设置。
7. 检索获取采用延迟调用，识别和示例说明无需初始化向量库；真实流程检索失败可继续使用数据库说明。
8. 识别失败回退 QA；识别后事项被删/停用返回友好办事文本（service=null）。无步骤仍展示基础信息，无来源不报错。
9. 外链只接受 HTTP(S)，下载仅开放已启用事项绑定的文件，使用附件响应。发布时间来自管理员维护字段，不把上传时间当作文件发布时间。

## 6. Windows 启动

启动 MySQL，沿用 backend/.env 的 DB_URL、DB_USERNAME、DB_PASSWORD；AI 密钥仍在 ai-service/.env。三个 PowerShell 窗口分别执行，起始目录为仓库根目录：

```powershell
# Python
Set-Location ai-service
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```powershell
# Java：读取 backend/.env；构建后的日常启动可省略 -Build
.\scripts\start-backend.ps1 -Build
```

```powershell
# Vue
Set-Location frontend
npm run dev
```

学生端：`http://localhost:5173/knowledge/search`；管理端：`http://localhost:5173/admin/services`。原 Maven/Java 启动方式继续有效，但 Spring Boot 自身不会加载 backend/.env，须先设置环境变量。

## 7. 自动测试和验收

```powershell
# 仓库根目录
New-Item -ItemType Directory -Force tmp | Out-Null
ai-service/.venv/Scripts/python.exe -m pytest ai-service/tests -q --basetemp tmp/pytest-service-guide
Push-Location backend
mvn test
Pop-Location
Push-Location frontend
npm run build
Pop-Location
.\scripts\test-service-guide.ps1
```

本机中央仓库曾访问超时，验证使用 tmp 中的临时 Maven settings 和缓存依赖；没有修改用户全局 Maven 设置或项目仓库。网络受限时使用本地可访问的 Maven settings，不必修改依赖版本。

测试覆盖：学生证/宿舍识别、食堂/心理咨询地点回退、未知及低置信编码、歧义/否定、404/400、排序、版本冲突、级联删除、AI 真实连接失败、原 RAG 历史保留、HTTP/1.1、模型编造日期拦截、原文来源校验、示例隔离和延迟初始化。

本次验证记录：

- Java 自动测试 26 项；Python 自动测试 121 项；前端类型检查和生产构建。
- 真实 MySQL 迁移、重复导入、CRUD、步骤排序、409 版本冲突和外键失败回滚；临时创建的测试事项已删除。
- 真正关闭 Python 时，学生证补办仍返回完整六步卡片。
- 实际千问联调：学生证问题返回 SERVICE_GUIDE、6 步、aiEnhanced=true；心理咨询中心位置问题返回 QA、2 条知识库引用。
- 本机 Edge 无界面浏览器验证：学生问答卡片、六步时间线、材料勾选、390px 移动端无横向溢出、管理员列表及步骤移动编辑。截图在本地 `tmp/service-guide-card.png`、`tmp/service-guide-mobile.png`、`tmp/service-guide-admin-final.png`，不纳入业务资源。
- 原 PDF/OCR/DOCX/切分/Embedding/Chroma/Rerank/Qwen/文档管理的自动测试随完整套件通过。本次没有对所有格式重新逐一做真实云 OCR 上传；完整文档质量验收仍按原 README 和 `docs/ocr-upgrade.md` 执行。

推荐提问：

| 问题 | 预期 |
| --- | --- |
| 我的学生证丢了，应该怎么办？ | 学生证补办六步卡片和示例标识 |
| 我要申请奖学金 | 奖学金申请流程 |
| 心理测评怎么做？ | 心理测评流程示例 |
| 我想申请病假 | 学生请假流程 |
| 宿舍水龙头坏了 / 宿舍灯坏了怎么报修？ | 宿舍报修流程 |
| 学校食堂几点开门？ | 普通 QA |
| 学校心理咨询中心在哪里？ | 原 RAG 普通 QA |
| 心理测评什么时候？ | 原 RAG 普通 QA，不被流程示例抢占 |

停止 Python 后重问学生证和宿舍报修，应继续显示卡片。普通 QA 在 AI 离线时仍沿用原错误行为。管理员可测试草稿发布、步骤排序、来源关联，以及两个编辑页面同时提交旧版本触发 409。

## 8. 新增与修改文件

新增 Java（以下包路径相对对应模块 `src/main/java/com/campusagent/`）：

- campus-affair：`affair/serviceguide/dto/{ServiceItemDTO,ServiceStepDTO,ServiceDetail,ServiceRecognitionResponse}.java`
- campus-affair：`affair/serviceguide/repository/{ServiceItemRepository,ServiceStepRepository}.java`
- campus-affair：`affair/serviceguide/service/{ServiceGuideService,ServiceIntentRecognizer,SemanticIntentMatcher,DatabaseServiceIntentRecognizer}.java`
- campus-affair：`affair/serviceguide/controller/{ServiceGuideController,AdminServiceGuideController}.java`
- campus-ai-integration：`aiintegration/serviceguide/{ChatResponse,ChatService,ServiceAiClient}.java`
- campus-app：`app/serviceguide/ServiceSourceController.java`
- campus-affair 测试：`ServiceGuideTest.java`；campus-ai-integration 测试：`ChatServiceTest.java`、`ServiceAiClientTest.java`
- SQL：`backend/campus-app/src/main/resources/db/migration/V3__service_guide.sql`、`db/seed/service_guide_examples.sql`

新增 Python：

- `ai-service/app/schemas/service_guide.py`
- `ai-service/app/services/service_guide_service.py`
- `ai-service/app/api/v1/endpoints/service_guide.py`
- `ai-service/tests/unit/test_service_guide_service.py`
- `ai-service/tests/integration/test_service_guide_api.py`

新增前端与脚本：

- `frontend/src/modules/serviceguide/types.ts`、`api.ts`
- `frontend/src/modules/serviceguide/components/ServiceGuideCard.vue`
- `frontend/src/modules/serviceguide/pages/ServiceManagementPage.vue`
- `scripts/start-backend.ps1`、`scripts/test-service-guide.ps1`
- 本文档 `docs/service-guide-v1.md`

修改既有文件：

- backend：campus-affair/pom.xml、campus-ai-integration/pom.xml；RagController.java（改用 ChatService）、RagService.java（复用请求校验）；AdminDocumentService.java（原文件读取）；GlobalExceptionHandler.java（参数/JSON 错误 400）；application.yml（V3 初始化、办事超时）、.env.example。
- Python：app/core/dependencies.py（新增服务装配）、app/api/v1/router.py（注册内部路由）。
- 前端：knowledge/types.ts、knowledge/pages/KnowledgeSearchPage.vue、admin/routes.ts、admin/AdminLayout.vue。
- 文档：README.md、backend/README.md、ai-service/README.md。
- 开发前已有的 `ai-service/app/llm/qwen_provider.py` 用户修改完整保留，本功能没有修改它。

## 9. 当前边界与下一阶段

未实现用户永久办事进度、办事多轮状态、条件分支、自动填写/登录真实学校系统、复杂自主 Agent。管理员 CRUD 已完成，但权限沿用项目现状，尚无登录和管理员鉴权；后续统一接入身份模块。

建议顺序：先把示例替换为有真实依据的学校事项，核对来源与版本；随后增加账号权限、事项按知识库隔离、稳定步骤 ID 与用户进度、文件更新复核提醒。数据规模增长后再增加分页、候选检索与意图评估集，最后考虑多轮办事上下文和条件分支，继续保留独立的普通 RAG 路径。
