# 查询意图路由修复

## 行为与修改范围

原实现将事项的主题词、动作词命中直接解释为需要办理流程。例如“体测不及格可以申请奖学金吗”包含“奖学金”和“申请”，绕过普通 RAG，进入指南叙述和卡片展示。

本次增加独立的 `QueryIntent`：`GENERAL_QA`、`POLICY_QA`、`ELIGIBILITY_QA`、`SERVICE_GUIDE`。`matched` 仅表示找到事项；只有匹配有效事项并且 `queryIntent == SERVICE_GUIDE`，Java `ChatService` 才返回 `type=SERVICE_GUIDE`。其余通过原 `RagService`，保留问题、历史、知识库范围、检索和重排计数、原始回答及引用。

Java 的 `QueryIntentRules` 优先判断明确的资格、政策、费用、期限、材料和流程表达。不明确的表达继续使用既有千问语义接口。Python 使用 Pydantic 枚举、候选编码及置信度校验结构化结果；模型不能自行决定公共响应 `type`。缺失意图默认 `GENERAL_QA`，非法输出或调用失败安全回退 QA。混合资格/政策与流程问题优先 QA。保留现有多事项歧义处理，不从多个事项中随意选第一个。

事项动作词仍用于识别具体事项：例如“宿舍怎么申请入住”虽然需要流程，但不能仅凭“宿舍”主题命中“宿舍报修”。明确流程问题还需要事项动作词、完整事项名或语义匹配确认；语义接口失败时不会仅靠宽泛主题强行返回指南。

旧心理测评配置把“什么时候、几点、时间、对象、在哪里”当作事项排除词。现在这五个查询方式词交由查询意图判断，兼容现有数据库；“咨询中心、校园卡”等用于区分事项的排除词仍有效。无需迁移、重建数据库或修改管理员事项记录。

QA 可以携带 `relatedService: {code, name}`，不附带完整指南。前端继续严格检查 `message.response.type === 'SERVICE_GUIDE'` 才挂载 `ServiceGuideCard`。管理员预览保持独立；V1.1 进度算法、缓存键、材料勾选和 localStorage 结构不变。

例如：

```json
{
  "type": "QA",
  "queryIntent": "ELIGIBILITY_QA",
  "answer": "根据知识库规定，评选学年体质健康测试成绩低于60分，不得参加评奖评优……",
  "relatedService": {"code": "SCHOLARSHIP_APPLICATION", "name": "奖学金申请"},
  "service": null,
  "steps": []
}
```

裸事项名称或单纯陈述“学生证丢了”“宿舍水龙头坏了”不再自动视为需要指南；“学生证丢了怎么办”“宿舍灯坏了怎么报修”仍为明确办理请求。历史 V1 文档中的对应示例以本说明为准。

## 自动测试与真实验收

2026-09-22 验证结果：

| 检查 | 结果 |
| --- | --- |
| Java 全模块 clean package | 67 项测试通过，最新可执行 JAR 已生成 |
| AI Service 完整 pytest | 136 项通过，覆盖 RAG、Qwen、Rerank、文档解析与 OCR 等既有功能 |
| 前端单元测试 | 26 项通过，包括 21 项 V1.1 测试及 5 项真实模板渲染测试 |
| 前端类型检查和生产构建 | 通过 |
| 20 个指定问答的真实浏览器验收 | 10 个 QA、10 个 SERVICE_GUIDE 均通过 |
| 真实千问语义识别 | 非规则表达可识别明确流程意图，非法输出仍由自动测试验证回退 |
| 宽泛事项主题隔离 | “宿舍怎么申请入住”真实识别结果为 matched=false，不误入宿舍报修 |
| QA 卡片隔离 | 附带 relatedService/serviceCode/service/steps 均不显示卡片，不改 localStorage |
| V1.1 开发站点回归 | 步骤推进、回退、完成、重新开始、材料恢复、刷新、多事项、多卡片同步均通过 |
| V1.1 生产构建回归 | 含页面启动前禁用 localStorage、损坏缓存、版本重置、空步骤等边界，均通过 |
| 管理员事项管理 | 数据库聚合增改删、版本冲突自动测试通过；真实页面预览、编辑器排序/取消通过 |
| 真实上传 / RAG / Rerank / 千问 | 管理员页面 TXT 上传成功，召回 10、重排 10，千问回答包含上传的测试编号 |
| 真实 OCR | 管理员页面 PNG 上传成功，ocrProvider=qwen，切分及向量入库成功 |
| 临时测试数据清理 | 本次上传的 TXT/PNG、对应元数据及向量已删除 |

体测问题的真实回答为“不可以。根据知识库规定，评选学年体质健康测试成绩低于60分，不得参加评奖评优；且奖学金评选条件中明确要求体质测试达60分以上（含60分）。”来源来自已有“奖学金评选条件.pdf”和“校综测文件.pdf”，召回 10、重排 10、采用 3 个片段。响应为 QA + ELIGIBILITY_QA，保留奖学金 relatedService，页面不显示办事卡。

真实上传专项使用 TXT/PNG；PDF/DOCX 解析和 Paddle OCR 回退由现有自动测试覆盖，没有重新解析用户已有文档。

新增测试位置：

- `backend/campus-ai-integration/src/test/java/com/campusagent/aiintegration/serviceguide/QueryIntentRoutingTest.java`：全部 20 个指定例句、RAG 保留、关联事项、混合意图、语义兜底、缺失枚举、旧排除词兼容。
- `ai-service/tests/unit/test_service_guide_service.py`：四种合法枚举、非法/缺失字段、伪造 type、错误置信度与 Provider 超时。
- `frontend/tests/queryIntentRendering.test.mjs`：编译并渲染真实页面模板，断言 QA 即使携带 service/steps/relatedService/serviceCode 也不会挂载卡片。
- `frontend/tests/browser/queryIntent.e2e.mjs`：20 个真实浏览器问答、现有学校资料的体测条款、千问语义兜底、恶意或错误附带字段不渲染卡片且不改动 localStorage。

在仓库根目录分别执行：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent\backend
mvn.cmd clean test

cd D:\AIC_ai-agent\Project\Campus-Agent\ai-service
.\.venv\Scripts\python.exe -m pytest -q --basetemp=../tmp/pytest-query-intent

cd D:\AIC_ai-agent\Project\Campus-Agent\frontend
npm.cmd test
npm.cmd run build
```

本机 Maven 验收使用已有依赖与本地 settings，完整测试并打包：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent\backend
mvn.cmd '-Dmaven.repo.local=C:\Users\Z\.m2\repository' -o -s ../tmp/maven-service-guide-settings.xml clean package
```

浏览器脚本使用本机 Edge 和已有 `tmp/browser-check/node_modules/playwright-core`，没有新增生产依赖。其他机器可设置 `PLAYWRIGHT_MODULE_PATH` 与 `BROWSER_EXECUTABLE`。三个服务启动后：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent
node frontend/tests/browser/queryIntent.e2e.mjs
node frontend/tests/browser/serviceProgress.e2e.mjs
node frontend/tests/browser/existingFeatures.e2e.mjs
```

生产构建的存储边界回归另开前端预览终端，执行 `npm.cmd run preview -- --host 127.0.0.1 --port 4173`，随后在仓库根目录：

```powershell
$env:CAMPUS_BASE_URL = 'http://127.0.0.1:4173'
$env:TEST_PRODUCTION = '1'
node frontend/tests/browser/serviceProgress.e2e.mjs
Remove-Item Env:CAMPUS_BASE_URL, Env:TEST_PRODUCTION
```

`queryIntent.e2e.mjs` 的体测回答验收依赖现有知识库中的真实体测/奖学金资料；未导入这些资料的新环境须先导入。脚本不伪造学校政策。`existingFeatures.e2e.mjs` 会通过管理员页面上传两份明确标为临时测试的 TXT/PNG 资料，并在 finally 清理本次创建的文档、向量和元数据。真实问答与 OCR 会调用已配置的千问服务。

截图及响应记录：`tmp/query-intent/eligibility-qa.png`、`tmp/query-intent/scholarship-guide.png`、`tmp/query-intent/results.json`。测试输出位于 `tmp/query-intent-*.log`，均为忽略的本地验收产物。

## Windows 逐步启动与复验

1. 确认 MySQL 正在运行：

```powershell
Get-Service MySQL80
# 仅当状态为 Stopped 时，在有服务管理权限的终端运行：
# Start-Service MySQL80
```

2. PowerShell 终端 1，启动 AI：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent\ai-service
# 本机已有模型缓存，验收使用下面两项；全新机器尚无缓存时不要设置。
$env:HF_HUB_OFFLINE = '1'
$env:TRANSFORMERS_OFFLINE = '1'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

继续读取现有 `ai-service/.env`，无需重新填写或修改密钥。上述离线开关只用于本地模型缓存，千问问答仍需要联网。

3. PowerShell 终端 2，启动 Java：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent
.\scripts\start-backend.ps1
```

本次已构建最新 JAR，直接启动即可。以后修改 Java 源码可运行 `.\scripts\start-backend.ps1 -Build`。脚本读取现有 `backend/.env`。

4. PowerShell 终端 3，启动前端：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent\frontend
npm.cmd run dev -- --host 127.0.0.1
```

5. 打开学生页 <http://127.0.0.1:5173/knowledge/search>。管理员页面为 <http://127.0.0.1:5173/admin/services>。

- 问“体测不及格可以申请奖学金吗？”：应回答体测低于 60 分不得评奖评优，显示资料引用，无完整办事卡。
- 问“奖学金怎么申请？”：应出现奖学金办事卡。
- 问“学生证补办收费吗？”、“心理测评必须参加吗？”：应为 QA。
- 问“学生证怎么补办？”、“心理测评怎么操作？”、“心理测评在哪里做？”：应出现对应办事卡。
- 在卡片完成一步并勾选材料，刷新后再次明确询问流程，应恢复本地进度；随后询问相关政策，应只回答 QA，不重置流程。

每个终端按 `Ctrl+C` 可停止对应服务。

## Git 与服务状态

开发分支：`feature/query-intent-routing`。2026-09-23 已经复验确认，并授权提交修复、合并到 main 和推送至 GitHub 仓库 `unseek4-cloud/Campus-Agent`。

验收结束后已关闭本次启动的 AI、Java、前端开发服务和生产预览，并确认 8000、8080、5173、4173 均无监听。MySQL80 保持运行。关闭记录：`tmp/query-intent-shutdown.json`。
