# 第一阶段优化与当前状态

本文保留 2026-10-12 的优化范围，并按当前统一 Vue 代码更新说明。旧静态前端已删除，测试命令和当前结果见 [前端 README](../frontend/README.md) 与 [文档索引](README.md#本次检查与验证)。

## 已实现的调整

| 调整 | 当前实现与限制 |
| --- | --- |
| 必交材料逐项检查 | 前端按材料项选择文件；Java MaterialSubmissionValidator 校验数量、归属和覆盖，内容合格仍需审核 |
| 要求快照 | V10 的两张表保存申请提交时要求和附件分类；事项修改不改变旧补交要求，没有完整政策/事项版本快照 |
| 固定分享范围 | 创建时展开全部/选中消息 ID，继续聊天不加入旧链接；旧无 ID 链接按创建时间限制 |
| 重排故障诊断 | RAG 禁用重排或召回有内容但全部无分数，报 RERANK_UNAVAILABLE，普通检索仍可用 |
| 截止日期问法 | 支持截止、截至、最晚、哪一天、期限及前一行短标题；不计算相对时间，不实现政策生效规则 |
| 材料表单 | 切换事项清文件/分类，显示必交缺项；补交读取当前版本并采用原要求，仍可能因并发返回 409 |

材料接口继续 multipart files/materialIds 按位置对应，空分类表示其他附件；新申请需要必交项全部覆盖，补交只需本次文件属于原要求。历史无快照请求保持兼容，不凭当前事项反推历史条件。

## 复验

按 [统一启动](service-application-startup.md) 准备环境：

1. 两项必交要求只传一项、两个文件归到同一项、伪造外部材料 ID、分类数不等于文件数，均应拒绝。
2. 已申请后修改当前事项，补交界面和服务端继续使用原要求；旧 version 不能覆盖新记录。
3. 创建整体分享后继续聊天，旧链接不包含新消息；空会话分享拒绝。
4. 使用不同截止问法检查证据角色；默认时间权重是否改善答案需用实际语料评测。
5. 独立测试配置禁用重排确认诊断异常，恢复后真实问答继续工作，不能以关重排解决 RAG 故障。

自动覆盖在 ApplicationIntegrationTest、ChatShareIntegrationTest、Python test_temporal_evidence_rerank.py/test_rag_api.py，以及当前 workspace.application-materials.e2e.mjs/workspace.chat-workspace.e2e.mjs。标准入口是 backend 的 mvn test、Python pytest 和 frontend 的 npm run test:browser。

本次只更新文档，没有执行 MySQL 迁移或云模型评测。历史固定通过数量、临时 Maven 路径和第二套界面步骤已移除。前端改密和申请附件链接不一致仍待代码修复，详见 [检查记录](README.md#文档检查与待确认项)。
