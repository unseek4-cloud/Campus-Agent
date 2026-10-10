# 智能问答首页与办事步骤恢复

## 界面与交互

学生的默认入口改为智能问答。空会话以居中的标题、输入框和三个问题入口作为视觉重点；开始对话后，消息区域独立滚动，输入框留在底部。历史会话移到左侧导航，统计概览作为独立的“事务概览”入口保留。管理员默认进入管理概览。

蓝紫渐变、玻璃表面、圆角、登录标题动画和明暗主题保持现有风格。移除问答页右侧的说明卡、重复标题、没有行为的通知按钮，以及会话编号和接口路径。检索计数与改写问题改为默认折叠的“本轮检索信息”。Ctrl/Cmd+K 在问答页聚焦输入框，中文输入法确认回车不触发发送。

办事卡只在 `type === SERVICE_GUIDE && service` 时展示。恢复旧 V1.1 的当前步骤、完成/回退、完成页、确认重置、材料勾选、刷新恢复和重复卡片同步。当前步骤直接展示，完整流程可展开。步骤顺序按后端正整数 `order` 排序去重，不以 AI 文本或后端 `currentStep` 推断已完成。材料勾选独立于步骤完成。

进度使用原 Vue 的 `ServiceProgressStore`；浏览器直接加载其生成版本，不引入 Vue 或其他运行时依赖。开发时修改原领域模块后执行：

```powershell
node scripts/sync-standalone-progress.mjs
node scripts/sync-standalone-progress.mjs --check
```

需要已有 `frontend/node_modules/typescript`；普通启动静态前端无需执行生成命令。

## 与后端的适配

- 首次真实提问时创建会话，再携带 `conversationId` 和 UUID `requestId` 调用 `/api/rag/chat`；失败问题保留在后端已有会话中，避免丢失其归属。
- 浏览器只保存当前用户的会话 ID；消息内容仍从 Java/MySQL 读取。刷新、页面返回和深链加载历史，会话切换和新建操作使过期的异步读取失效。
- 后端 `messages.pending` 为 true 时暂停发送并轮询消息，生成结束后自动恢复输入。
- 材料附件使用后端 DTO 的 `attachment.downloadUrl` 和中文 `filename`，申请入口使用真实 `service.id`。
- 个人准备进度按登录用户和事项隔离在当前浏览器，状态包含原来的 `serviceId`、`serviceVersion`、`currentStep`、`completedSteps` 和 `checkedMaterials`。版本变更重置旧状态；重复卡片共享操作保护，旧版本不能覆盖新流程。
- 个人清单不代表审批进度；学校办理状态仍查看“我的申请”。不新增审批接口或数据库表。旧 Vue 页面所在端口的 localStorage 不会跨端口迁移到新前端。
- 公开分享页使用相同的结构化内容展示，但不显示个人清单、推进/回退、模板下载或申请按钮，不提供需要登录的操作。
- 图片复制与导出使用实际传入的消息列表；选中消息只导出该选择，公开页使用分享接口返回的消息。没有持久化 ID 的消息无法创建公开链接，不会降级为分享全部消息。
- 本地存储被禁用时，登录可继续，进度在内存中使用并显示保存不可用提示。

## 本机启动与手动验收

MySQL 保持运行，沿用已有 `.env` 和账号。`backend/.env` 的 `AUTH_ALLOWED_ORIGINS` 需要包含 `http://127.0.0.1:5500`。若后端配置变更，先停止旧后端，再启动。

三个 PowerShell 窗口：

```powershell
# 窗口一：Java
cd D:\AIC_ai-agent\Project\Campus-Agent
.\scripts\start-backend.ps1

# 窗口二：AI（需要真实政策问答时）
cd D:\AIC_ai-agent\Project\Campus-Agent\ai-service
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 窗口三：新前端
cd D:\AIC_ai-agent\Project\Campus-Agent\frontend-standalone
..\ai-service\.venv\Scripts\python.exe -m http.server 5500 --bind 127.0.0.1
```

访问 `http://127.0.0.1:5500/`，有旧缓存时 Ctrl+F5。

1. 学生登录，确认进入智能问答。新建对话时显示居中输入框，左侧显示历史。
2. 提问“学生证丢了，怎么补办？”，确认展示结构化卡片和当前步骤，输入框始终可见。
3. 展开完整办理流程，确认当前/已完成/待完成三态正确；勾选材料不能自动完成步骤。
4. 完成当前步骤，确认只推进一步；回退、完成全部、返回最后一步、取消与确认重新开始均正确。
5. 刷新，再从历史打开该会话，核对步骤、材料勾选和模板下载。实际学校申请进度仍到“我的申请”查看。
6. 点击“立即办理”，确认表单选中同一事项，已存在办理中申请时按原后端规则提示。
7. 多选一条已保存的回答，分别导出图片、生成链接。图片和免登录页应只包含所选内容。分享页不应出现步骤操作与申请入口。
8. 撤销链接，在无痕窗口刷新确认失效。
9. 手机宽度下检查输入框、侧栏抽屉、历史切换与步骤按钮；浅色与深色主题均应可读。

## 验证工具

```powershell
# 桌面/手机、浅色/深色、模拟真实 DTO 的浏览器测试
node frontend-standalone/tests/chat-workspace.e2e.mjs

# 原领域、聊天历史与路由测试（已修正 Windows CRLF 下的 import 清理）
cd frontend
npm.cmd test
```

浏览器测试沿用 `tmp/browser-check/node_modules/playwright-core` 与本机 Edge；其他环境可设置 `PLAYWRIGHT_MODULE_PATH`、`BROWSER_EXECUTABLE`。界面截图在忽略目录 `tmp/chat-workspace/`。

`tests/chat-workspace.live.mjs` 可连接实际 Java/MySQL；默认读取本机忽略目录里的既有测试凭据，不打印密码，只创建自己的测试对话并在 finally 删除该会话及分享链接。运行前需要 Java 与静态前端就绪。该测试只验收数据库办事引导，不代替真实千问政策问答的验收。

2026-10-10 本机验证结果：浏览器交互 54 项通过；真实 Java/MySQL 联调 14 项通过；原前端自动测试 32 项通过；`npm run build`、JavaScript 语法检查和生成模块一致性检查通过。实际联调覆盖数据库流程降级、历史、模板下载、申请入口和公开分享撤销，没有重测真实千问政策问答。测试创建的会话/分享已清理，临时前端和后端已停止，原 MySQL 服务保留。
