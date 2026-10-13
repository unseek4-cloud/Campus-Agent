# 查询意图与办事路由

查询“能否申请奖学金”和“奖学金怎么申请”都可能命中奖学金事项，但前者需要政策依据，后者需要流程。当前代码分别识别事项主题与查询意图，只有有效事项匹配且 queryIntent=SERVICE_GUIDE 才返回流程卡片。

## 路由规则

| 意图 | 例子 | 当前分支 |
| --- | --- | --- |
| ELIGIBILITY_QA | 体测不及格可以申请奖学金吗 | RAG，答案以实际知识库为准 |
| POLICY_QA | 学生证补办收费吗、报名什么时候截止 | RAG |
| GENERAL_QA | 普通概念咨询、否定办理或未能明确判断 | RAG |
| SERVICE_GUIDE | 学生证丢了怎么办、奖学金怎么申请、准备哪些材料 | 仅唯一有效事项匹配后返回指南 |

Java [QueryIntentRules.java](../backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/service/QueryIntentRules.java) 依次判断否定、资格、政策、办理表达。混合资格/政策与流程优先 QA，不能靠“申请”两个字推断办理意图。

[DatabaseServiceIntentRecognizer.java](../backend/campus-affair/src/main/java/com/campusagent/affair/serviceguide/service/DatabaseServiceIntentRecognizer.java) 从 ACTIVE 目录读主题、动作和排除词。主题只确认关联事项，宽泛主题还需要动作/完整名称或语义确认。例如“宿舍怎么申请入住”不能仅因“宿舍”命中报修。多个主题、低置信度和 AI 异常不能随意选第一个。

旧规则中“什么时候、几点、时间、对象、在哪里”不再作为主题排除词，交给查询意图判断；“校园卡、咨询中心”等区分事项的排除词继续有效。无需为该兼容逻辑批量改写管理员目录。

## 语义兜底与返回

不明确时通过 ServiceAiClient 调 Python /internal/v1/service-guide/recognize。模型只可选启用目录的 code，Python 用枚举与置信度字段校验，Java 再验证候选归属、有限数值和 0.85–1 范围。缺 queryIntent 默认 GENERAL_QA；非法 JSON、编码、置信度或超时回退。

ChatService 对匹配主题但不需要流程的结果仍走 RAG，并可返回 relatedService={code,name}。QA 返回 type=QA、service=null、steps=[]；前端 [chat-rendering.js](../frontend/src/workspace/chat-rendering.js) 严格检查 type 和 service，附带主题信息不能触发卡片。

规则命中评分 0.93 和模型 confidence 不是经评测校准的准确率。事项识别只看本轮问题；Python 的普通多轮 Query Rewrite 只参与 RAG，不能替代持续的办理状态机。

## 测试与复验

当前测试位置：

- Java：QueryIntentRoutingTest、ChatServiceTest、ServiceGuideTest。
- Python：tests/unit/test_service_guide_service.py、tests/integration/test_service_guide_api.py。
- 前端：tests/turnRendering.test.mjs、tests/browser/workspace.chat-workspace.e2e.mjs。

运行 backend 的 mvn test、ai-service 的 pytest 和 frontend 的 npm test/npm run test:browser，具体命令见 [总览](../README.md#验证)。旧 queryIntent.e2e.mjs、serviceProgress.e2e.mjs、existingFeatures.e2e.mjs 已不在仓库，不引用旧本机临时设置或离线变量作为必要步骤。

按 [统一启动](service-application-startup.md) 准备环境，在 /#/qa 分别核查资格、费用、时间、明确流程、否定和宽泛主题。对资格问题应核对来源支持，不能把某次开发库中“60 分”答案当成所有学校的预期。

关闭 AI 时，明确规则匹配的流程可继续返回数据库指南；模糊语义表达可能回 QA。普通 QA 的 AI 不可用错误不能等同于路由成功，也不能通过放开权限解决。
