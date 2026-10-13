# CampusAgent 办事流程引导

本功能把明确的办理问题连接到 MySQL 中维护的事项与步骤。当前学生和管理员均可在问答页查看指南；管理员另在 /#/services-mgr 维护事项。普通政策/资格问答仍走 RAG，流程卡片不能代表实际申请已提交或审批已完成。

## 架构与分流

```text
Vue POST /api/rag/chat
→ ChatHistoryService 保存问题并读取数据库历史
→ ChatService 校验请求
→ DatabaseServiceIntentRecognizer
  → 启用目录、主题词、动作词、排除词
  → QueryIntentRules
  → 不明确时可调用 Python 语义识别
  ├─ 未匹配或意图不是 SERVICE_GUIDE → 原 RAG
  └─ 有效事项且 SERVICE_GUIDE → ServiceGuideService
      → MySQL 事项/步骤 → 可选 Python narrate → 结构化卡片
```

查询意图有 GENERAL_QA、POLICY_QA、ELIGIBILITY_QA、SERVICE_GUIDE。matched 只表示找到事项；资格、费用、截止时间等即使命中事项，也不会自动返回流程。混合资格/政策与流程优先 QA。详见 [查询意图](query-intent-routing.md)。

事项属于 campus-affair，AI 编排属于 campus-ai-integration，来源文件下载由 campus-app 组合公开服务。规则对标点、空白和大小写归一化；宽泛主题还需动作词、完整事项名或语义确认，避免“宿舍申请入住”误匹配报修。规则评分 0.93 不是概率校准结果；语义编码必须属于启用目录，置信度至少 0.85。

识别主要使用当前问题，不维护多轮办事主题状态。普通 RAG 的历史改写不等于办事流程连续追踪。

## 事项、材料与步骤

service_item 保存唯一 code、分类、说明、部门、地点、办公时间、联系、条件、材料、recognition_rules、截止描述、来源、status、is_example 和 version。状态为 DRAFT、ACTIVE、DISABLED。

requirements 为字符串数组，materials 为带稳定 id/name/description/required 的 JSON 数组，attachment 从模板表补入；recognition_rules 为 subjects/actions/exclusions 数组。材料上限 50，条件和各类识别词最多 50 项。启用事项需主题词和动作词，但代码不强制具备完整学校依据、步骤或联系方式，发布质量需管理员核对。

service_step 保存 order、标题、说明、责任部门、材料名称、地点和预计时间。保存时在同一事务删除旧步骤并按数组顺序重建，order 从 1 编号；stepId 不稳定。保存递增事项 version，旧版本更新/删除返回 409。来源 source_document_id 关联 knowledge_document；删除原文档将 ID 置空，来源标题保留。

材料模板的稳定 ID、立即生效规则和上传接口见 [模板附件](material-attachments.md)。本地进度按事项版本恢复，详见 [准备进度](service-progress-v1.1.md)。有历史申请的事项不能硬删除，应改为 DISABLED；停用仍保留已有申请的审核记录。

## API 与响应

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | /api/services | 启用事项数组，当前无分页 |
| GET | /api/services/{id} | service、steps；不存在/停用返回 404 |
| GET | /api/services/{id}/steps | 有序步骤 |
| POST | /api/services/recognize | query → matched、serviceCode、serviceName、confidence、queryIntent |
| GET | /api/services/{id}/source | 登录下载启用事项绑定的原文件 |
| GET | /api/admin/services、/{id} | 管理员全部状态列表与详情 |
| POST | /api/admin/services | 新建 service、steps |
| PUT | /api/admin/services/{id} | 整体保存，回传 service.version |
| DELETE | /api/admin/services/{id}?version=N | 版本匹配后删除 |
| POST | /api/rag/chat | 兼容原问答，增加结构化返回 |

所有 JSON 使用 ApiResponse，问答还包含 conversationId/userMessageId/assistantMessageId。完整会话请求见 [历史说明](chat-history.md)。办事数据示意：

```json
{
  "type": "SERVICE_GUIDE",
  "answer": "你首先应该完成“准备材料”。",
  "service": {"id": 1, "code": "STUDENT_CARD_REISSUE", "isExample": true, "materials": []},
  "steps": [{"order": 1, "title": "准备材料", "requiredMaterials": []}],
  "source": {"title": "测试流程", "documentId": null, "publishTime": null, "url": null},
  "currentStep": 1,
  "queryIntent": "SERVICE_GUIDE",
  "aiEnhanced": false,
  "sources": []
}
```

示意省略其他字段，实际 ID 取响应。currentStep 有步骤时固定 1，否则 0，不是用户完成状态。QA 可携带 relatedService，但 service=null、steps 为空，不应挂载卡片。

## 事实、来源和降级

卡片数据来自 MySQL，模型不能改写步骤/材料。Python narrate 复用检索、过滤和 Context；绑定文档时只接受该文档的片段。模型最多选择两段连续原文，每段 8–240 字符，程序校验后补到数据库首步说明。示例流程不借真实政策，Java 确定性添加示例标识。

AI 请求异常、超时、缺 Key 或 Python 离线时，已匹配的流程仍返回数据库卡片及首步说明，aiEnhanced=false。办事客户端连接超时 2 秒，单次读取默认 12 秒，可配 SERVICE_GUIDE_AI_TIMEOUT_SECONDS；模糊识别和说明可能各调用一次，不能把 12 秒当作整个问题的总 SLA。普通 RAG 超时另行配置。

aiEnhanced=true 只说明辅助调用返回有效结果，未必有补充引用。事项在识别后被删除/停用时返回友好文本和 service=null。外链只允许 HTTP(S)，文件源由实际文档 ID 读取；发布时间是管理员维护字段，不能用上传时间自动替代正式发布时间。

## 初始化与验收

V3 随后端启动建表；SQL 机制见 [数据库说明](../backend/README.md#数据库设计与升级)。五项示例在 [service_guide_examples.sql](../backend/campus-app/src/main/resources/db/seed/service_guide_examples.sql)，需显式导入。学生证补办 6 步、奖学金 5 步、心理测评 4 步、请假 5 步、宿舍报修 5 步，共 25 步；全部标记 is_example=true。重复导入不覆盖已存在编码，不能推断当前数据库已经导入。

按 [启动说明](service-application-startup.md) 启动后，问“学生证丢了怎么办”“奖学金怎么申请”“宿舍灯坏了怎么报修”，检查流程、来源和示例标记；问“申请资格是什么”“补办收费吗”“心理测评什么时候”，检查 QA 路由。裸事项名称或单纯描述故障不保证返回指南。

自动覆盖在 ServiceGuideTest、ChatServiceTest、QueryIntentRoutingTest、Python test_service_guide_service.py，以及前端 turnRendering.test.mjs 和 workspace.chat-workspace.e2e.mjs。标准命令见 [总览验证](../README.md#验证)。scripts/test-service-guide.ps1 需真实后台、应用账号及示例，会创建验收会话，不自动清理。

目前尚无永久准备清单、条件分支、自动填表、学校系统登录与提交或复杂 Agent。事项知识库授权和稳定步骤身份也未实现。
