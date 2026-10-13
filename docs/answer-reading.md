# 回答排版、引用原文件与管理员历史

回答现在支持常见 Markdown 的标题、重点加粗、段落、分级列表、表格、引用和代码块。标题与正文使用不同字号；回答中的原始 HTML 作为文字显示，Markdown 链接仅允许 HTTP(S)。历史回答和公开分享使用相同排版。

底部只显示一条最相关的引用：优先比较重排分数（存在最终分数时优先最终分数），相同时比较检索相似度。全部原始引用仍保留用于管理员核查和历史记录。点击引用在新标签页打开原文件；PDF 链接带引用页码，Office 文件下载后查阅。“更多 → 查看知识来源”展示同一条最佳引用，并提供打开原文件按钮。

新增 `GET /api/knowledge/documents/{id}/file`。使用现有登录认证，学生和管理员均可读取当前政策知识库中已成功处理的来源文档。未登录、文档不存在、其他知识库或文档尚未完成时，文件不会返回。PDF、图片和纯文本使用安全类型预览；Office 文件提供下载。公开分享不提供此登录文件入口。

管理员登录后，即使首页是事务概览，也会自动加载侧边栏最近对话，无需先点新建对话或进入智能问答。学生登录后仍进入空白新对话。

## 启动与验收

本次有新的后端文件接口，需要先停止旧后端，再重新构建启动：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent
powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1 -Build
```

如果旧后端仍占用 JAR，Maven 可能提示无法重命名或打包；先停止原后端再运行上述命令。开发前端刷新即可加载修改。前端与 AI 服务完整命令见 [三服务启动说明](feedback-profile-acceptance.md#启动三个服务)。

1. 管理员登录，停留事务概览，确认“最近对话”立即有历史列表。
2. 点击历史问题，或发送助学金等问题，确认标题、加粗重点和列表正常显示，不再直接显示 `**` 标记。
3. 回答底部仅显示一条引用。点击后打开原文件，PDF 可定位引用页码。
4. 分别用学生和管理员测试引用文件；公开分享仍可阅读答案，但原文件入口不对匿名访客开放。
5. 一并检查 [政策上传进度](policy-upload-progress.md)，上传后等待自动成功提示，无需刷新。

自动检查：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent\frontend
npm test
npm run build
node tests/browser/workspace.answer-sources.e2e.mjs
```

浏览器截图位于 `tmp/answer-sources/`。本次验收期间旧后端占用常规 JAR，因此另在 `tmp/backend-chat-display-build/campus-app/target/` 生成了可执行后端包；源代码和后端测试仍位于 `backend/`。
