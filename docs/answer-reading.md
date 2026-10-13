# 回答排版与来源原文件

当前回答支持常见 Markdown 标题、加粗、段落、嵌套列表、表格、引用和代码块，历史及公开分享复用渲染。原始 HTML 转义为文字；Markdown 链接只允许 HTTP(S)。实现位于 [answer-markdown.js](../frontend/src/workspace/answer-markdown.js)，不是完整通用 Markdown 引擎。

## 引用选择与原文件

底部显示一条最佳引用，优先 finalScore（若有）、rerankScore、score，平分再比较相似度，无评分时按原顺序取首条。全部 sources 仍保留用于历史/后台。实际 RAG DTO 只含 score/rerankScore，没有检索接口的 finalScore；历史快照又删除这两个评分，所以恢复后最佳引用可能与实时回答不同。

点击引用在新标签页打开 /api/knowledge/documents/{documentId}/file，正整数 pageNumber 拼 #page=N。PDF 可定位页，Office 下载后查看；DOCX 无可靠页码，不能伪造。更多查看知识来源使用同一条引用。

该 Java 接口要求 STUDENT/ADMIN 登录，只读当前 ADMIN_KNOWLEDGE_BASE_ID 内 SUCCESS 的文件。不存在、其他知识库或未完成文档返回错误。PDF/图片/纯文本 inline，Office attachment，响应 no-store/private 和 nosniff。

公开分享保留引用摘要但隐藏需要登录的原文件入口；办事来源另走 /api/services/{id}/source。进入 Context 的引用不代表模型每个事实句均已经验证。

## 验收与测试

按 [启动说明](service-application-startup.md) 运行，管理员停留 /#/dashboard 检查本人最近对话；学生主动登录进入空对话。发送或打开带 Markdown 的回答，核对标题、列表、HTML 转义和来源；用真实 PDF 检查页码，用学生/管理员/匿名确认原文件权限。历史评分缺失的情况也应检查。

在 frontend 目录运行 npm test、npm run build，然后 `node tests/browser/workspace.answer-sources.e2e.mjs`。浏览器测试模拟 API，截图在 tmp/answer-sources，不代表实际来源文件已在数据库存在。当前结果见 [文档索引](README.md#本次检查与验证)。

本次不再依赖旧 tmp 下的替代后端包。源码和正式构建入口在 backend，运行前按需要重新打包。
