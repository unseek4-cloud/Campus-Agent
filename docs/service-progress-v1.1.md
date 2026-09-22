# 智能办事进度跟踪 V1.1

## 本次交付

学生在 SERVICE_GUIDE 卡片中逐步确认完成、回退、查看完成百分比，并在同一浏览器再次查询该事项时恢复本地进度。完成只代表用户在 CampusAgent 中确认了引导步骤，实际办理状态以学校系统、部门审核或最新通知为准。

实现了三态 Timeline、当前步骤详情、最后一步完成页、确认后重新开始、材料勾选保存、事项隔离、重复卡片同步、缓存校验、版本变更提示及快速点击保护。条件、材料、步骤、来源及示例标识继续来自原有结构化返回。

没有修改 Java、Python、API、数据库结构、service_item 或 service_step 业务数据；没有添加账号、审批、学校系统调用或永久进度表。原有管理员卡片保持预览模式。

## 真实代码与兼容边界

- 后端响应是 `campus-ai-integration/.../serviceguide/ChatResponse.java`，没有另建 ServiceGuideResponse。有步骤时原接口固定返回 `currentStep=1`，无步骤返回 0。
- `ServiceStepDTO.order` / 前端 `ServiceStep.order` 对应数据库 `step_order`。本地进度不使用步骤自增 ID。
- 现有 `ServiceItem.version` 已由管理员保存操作递增；数据库还有 `updated_at`。因此直接复用版本，无需后端扩展。
- 聊天页仅在 `type === 'SERVICE_GUIDE' && service` 时渲染卡片并传入 `track-progress`。默认不启用跟踪，管理员使用现有调用方式即可。
- 保留 `currentStep` prop 和原 API。启用跟踪后，前端以本地确定性状态为准，不把后端 currentStep 或 LLM 文字当作完成依据。

## 文件清单

新增：

| 文件 | 职责 |
| --- | --- |
| `frontend/src/modules/serviceguide/services/serviceProgress.ts` | 独立存储、缓存校验、推进与回退、材料状态、订阅通知 |
| `frontend/src/modules/serviceguide/composables/useServiceProgress.ts` | Vue 响应式连接、派生状态、按钮保护及卸载清理 |
| `frontend/src/modules/serviceguide/components/ServiceProgressTimeline.vue` | 步骤三态及管理员流程预览 |
| `frontend/src/modules/serviceguide/components/CurrentStepPanel.vue` | 当前步骤详情与操作 |
| `frontend/tests/serviceProgress.test.mjs` | 21 项进度单元测试 |
| `frontend/tests/browser/serviceProgress.e2e.mjs` | 真实服务浏览器验收及响应夹具边界测试 |
| `frontend/tests/browser/existingFeatures.e2e.mjs` | 管理员上传、真实 RAG/千问、图片 OCR 回归 |
| `docs/service-progress-v1.1.md` | 本说明 |

修改：

- `frontend/src/modules/serviceguide/types.ts`：ServiceProgress、ServiceProgressStorage 类型。
- `frontend/src/modules/serviceguide/components/ServiceGuideCard.vue`：组合进度组件、材料绑定及重置确认。
- `frontend/src/modules/knowledge/pages/KnowledgeSearchPage.vue`：仅给学生 SERVICE_GUIDE 卡片启用跟踪。
- `frontend/package.json`：增加 `npm test`，复用现有 TypeScript 编译器和 Node 测试运行器，无新依赖。
- `README.md`：新增 V1.1 入口。

## 本地数据与算法

Key 为 `campusagent:service-progress:{serviceCode}`，例如：

```json
{
  "serviceCode": "PSYCHOLOGICAL_ASSESSMENT",
  "serviceId": 3,
  "serviceVersion": 0,
  "currentStep": 2,
  "completedSteps": [1],
  "checkedMaterials": [],
  "completed": false,
  "updatedAt": "2026-09-22T10:00:00.000Z"
}
```

数据流：数据库流程 → 原 `/api/rag/chat` → 卡片加载 store → 校验并恢复缓存 → 用户操作 → 更新内存及 localStorage → 订阅的卡片更新。推进、回退、材料勾选和重置均不调用后端或 LLM。

1. 按正整数 `order` 排序并去重。无步骤时 currentStep=null、completed=false，不显示进度条或操作按钮。
2. 初始选第一个合法步骤，completedSteps 为空。
3. 完成时校验当前步骤与按钮期望一致，将该 order 去重加入 completedSteps，再取排序数组中的下一项。不能用 currentStep+1。
4. 最后一步完成后保留最后一个合法 order，设置 completed=true。进度按 completedSteps.length / steps.length 计算，最后为 100%。
5. 回退到上一数组项，移除该步及之后的完成记录；第一步不可回退。完成页可重新打开最后一步。
6. 重置必须经过确认，清空该事项的步骤和材料状态，保存第一步初始状态，不影响其他事项。
7. 缓存损坏或结构异常时回退初始状态。同版本缓存只保留合法、连续已完成前缀，选择第一个未完成步骤；新插入的未完成步骤不会被跳过。完全完成后追加步骤可恢复到新增步骤。
8. serviceVersion 或 serviceId 变化时保守重置全部本地状态并提示“该办事流程已更新，已根据最新流程重新开始引导。”管理员现在会重建并重新编号步骤，因此不能仅靠相同 order 认定旧步骤仍有相同含义。
9. 同一页面的重复卡片通过共享 store 订阅更新。已加载更高版本后，旧版本卡片不能覆盖新定义，并提示使用最新回复。
10. store 按事项设置 500ms 操作锁，组件同步禁用按钮；防止双击和过期点击跨越多步。材料勾选独立于步骤，永不自动完成。
11. localStorage 读取、解析、写入、删除均受异常保护。被禁用或配额不足时使用内存并显示保存不可用提示。

## Windows 启动

已有数据库与 `.env` 配置保持不变。分别在三个 PowerShell 终端启动：

```powershell
# 检查 MySQL；未启动时可在有服务管理权限的终端启动
Get-Service MySQL80
# Start-Service MySQL80

# 终端 1：仓库根目录
cd ai-service
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 终端 2：仓库根目录，脚本读取 backend/.env
.\scripts\start-backend.ps1
# 后端源码变化或尚无 jar 时使用 -Build

# 终端 3：仓库根目录
cd frontend
npm.cmd run dev -- --host 127.0.0.1
```

学生页：http://127.0.0.1:5173/knowledge/search 。管理员：http://127.0.0.1:5173/admin/services 。本次验收使用 MySQL 3306、AI 8000、Java 8080、Frontend 5173。用户人工验收通过后，已按要求关闭 AI、Java 和前端服务，保留 MySQL；再次访问前按上文启动。

本次执行环境额外对 AI 进程设置了 `HF_HUB_OFFLINE=1`、`TRANSFORMERS_OFFLINE=1` 使用现有模型缓存，并允许其连接千问；没有改 `.env`。全新环境没有模型缓存时不要设置这两个离线变量。

## 测试命令与结果

```powershell
# frontend 目录
npm.cmd test
npm.cmd run build

# backend 目录
mvn.cmd test

# ai-service 目录：项目内临时目录避免 Windows 临时目录权限干扰
.\.venv\Scripts\python.exe -m pytest -q --basetemp=../tmp/pytest-progress-v11
```

本次 Maven 验收明确指定了已有依赖目录：

```powershell
# backend 目录；该 settings 是本机已有临时配置，不属于功能依赖
mvn.cmd '-Dmaven.repo.local=C:\Users\Z\.m2\repository' -o -s ../tmp/maven-service-guide-settings.xml test
```

浏览器测试使用本机 Edge 与已有 `tmp/browser-check/node_modules/playwright-core`，不新增生产依赖。另一台机器可自行安装测试工具并设置绝对模块路径：

```powershell
# 仓库根目录；本机现有安装可省略这两个环境变量
$env:PLAYWRIGHT_MODULE_PATH = 'C:\path\to\node_modules\playwright-core\index.mjs'
$env:BROWSER_EXECUTABLE = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node frontend/tests/browser/serviceProgress.e2e.mjs
node frontend/tests/browser/existingFeatures.e2e.mjs
```

本次还对生产构建运行了同一套浏览器验收，包括页面启动前就禁用 localStorage：

```powershell
# frontend 目录，单独终端
npm.cmd run preview -- --host 127.0.0.1 --port 4173

# 仓库根目录，另一个终端
$env:CAMPUS_BASE_URL = 'http://127.0.0.1:4173'
$env:TEST_PRODUCTION = '1'
node frontend/tests/browser/serviceProgress.e2e.mjs
```

本机 4173 生产预览已在用户人工验收通过后关闭。其进度与 5173 开发站点独立。

真实服务需已启动，千问需有效配置。`existingFeatures.e2e.mjs` 会创建两份明确标记为临时测试的 TXT/PNG 资料，执行真实千问调用并在 finally 中删除此次创建的资料、向量和元数据；不会删除已有资料。会消耗少量既有模型 API 额度。

2026-09-22 验收结果：

| 检查 | 结果 |
| --- | --- |
| 前端单元测试 | 21 项全部通过，包括需求 10 场景、单步骤、缓存异常、禁用存储、版本/事项 ID 变化、重复卡片、点击保护、材料独立性 |
| TypeScript + Vite 生产构建 | 通过；现有大包体积提示仍在 |
| Java 回归 | 26 项通过，0 失败/错误/跳过 |
| Python 回归 | 121 项通过；一个第三方弃用提示 |
| 真实心理测评 | 第一步、推进、双击、回退、全部完成、100%、刷新后再次查询恢复、重置取消/确认通过，aiEnhanced=true |
| 真实宿舍报修与普通 QA | 进度隔离通过；心理咨询中心地点问题返回 QA，无办事组件 |
| 重复卡片与移动端 | 同事项进度同步；390px 视口无横向溢出 |
| 管理员事项 | 预览不读取/改写学生进度，编辑器步骤移动可用，取消未保存 |
| 生产构建浏览器响应夹具 | 空步骤、10/20/30、材料刷新恢复、版本重置、单步骤、缺失字段、损坏/不可用存储全部通过；启动前禁用存储仍可完成流程 |
| 真实 TXT 上传与千问 | 已入库；召回 10、重排 10、使用 1 个上下文；答案含测试资料编号，来源 ID 正确 |
| 真实 PNG 上传与 OCR | Qwen OCR 成功，1 个 chunk 入库 |
| 清理与错误 | 临时测试资料已删除，浏览器无未捕获运行时错误 |

浏览器截图输出在忽略的 `tmp/service-progress-v11/`：`current-step.png`、`completed.png`、`mobile.png`。PDF/DOCX 解析及 OCR 回退本次由现有自动化测试覆盖；真实上传专项使用 TXT/PNG，没有对已有学校资料重新解析。

## 人工验收

1. 提问“心理测评怎么操作？”，确认第一个步骤高亮，第一次无完成记录。
2. 完成第一步，确认第二步详情、25%，双击不能直接到第三步；点击上一步能撤回完成状态。
3. 继续到最后一步，确认“办理引导已完成”、100%，并保留学校实际办理状态提示。
4. 刷新并再次询问同一事项，确认完成状态恢复；取消重新开始不变，确认重新开始回第一步。
5. 推进心理测评后提问“宿舍灯坏了怎么报修？”，确认报修从自己的第一步开始。
6. 提问“学校心理咨询中心在哪里？”，确认普通 QA 无进度组件。
7. 提问“学生证怎么补办？”，勾选材料后刷新并再问，确认材料勾选恢复但步骤不会自动完成。

本机数据库心理测评步骤实际是“查看测评通知 / 确认测评入口 / 完成测评 / 查看后续说明”，均为原有示例，不替换为需求中的示例名称。

## 限制与下一阶段

- localStorage 按浏览器、站点 origin 保存；localhost 与 127.0.0.1、不同端口的进度互不共享。清理站点数据后不可恢复，无账号和跨设备同步。
- 不提供多标签页实时合并；同时在多个标签办理同一事项可能最后写入覆盖。当前保证同一页面内重复卡片同步。
- 刷新后原有聊天历史仍清空，需要再次查询事项显示保存进度；本次没有增加聊天历史持久化。
- 所有管理员保存均增加 version，因此包括文字微调在内的版本变化都会保守重置。未来可增加专门的流程修订标识。
- 流程更新在下次收到新结构化响应时发现，不后台轮询管理员变更。
- 开发模式中，现有 Vue Router 调试工具会在应用启动时直接访问 localStorage，浏览器完全禁止该属性时会阻断调试工具启动；生产构建无此问题。开发站点测试在应用启动后禁用存储，生产验收则从页面启动前禁用并验证通过。本次没有修改第三方路由调试工具。
- “心理测评怎么操作？”当前依赖原有语义识别；千问不可用时该措辞可能回退 QA。可用已配置动作词“心理测评怎么参加？”检验规则识别。本次未改变 V1 识别词和降级策略。
- 完成只是 CampusAgent 中的用户确认，不等同于学校申请提交、审批或办结。

V1.2 可复用 ServiceProgress 类型、确定性状态算法和独立存储边界，增加异步账号进度 repository，映射 student_service_progress，补充服务端版本校验、并发冲突策略、历史记录和“我的办事”。本次不创建这些表或账号功能。

## Git

开发前 main 工作区干净，功能在 `feature/service-progress-v1` 独立分支开发。自动化回归和用户人工验收均已通过，用户已明确授权提交并合并至本地 main；本次不推送远程。AI、Java、前端开发服务及生产预览已按要求关闭。
