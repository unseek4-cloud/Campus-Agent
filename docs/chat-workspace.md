# 智能问答工作区

学生主动登录后默认进入 /#/qa 的空白对话，最近历史在左侧；管理员默认 /#/dashboard，同时加载本人最近对话。空对话居中显示输入框和问题入口，开始后消息区域独立滚动、输入框在底部。当前界面为统一 Vue 前端，颜色、布局和主题以 src/styles 为准。

Vue SFC 负责登录/外壳/问答容器，workspace.js 负责现有业务视图和弹窗。旧 frontend-standalone、生成进度副本与 sync-standalone-progress.mjs 已删除，修改 TypeScript 领域进度后无需同步第二份代码。

## 问答与恢复

当前输入框最多 2000 字符，Java/Python 接口最多 4000。Enter 发送、Shift+Enter 换行，中文输入法确认回车不发送；Ctrl/Cmd+K 聚焦问答或全局检索输入。

首次真实提问先创建会话，再携带 conversationId 和 UUID requestId 调 /api/rag/chat。用户问题先提交到数据库，失败不伪造回答；发送/恢复/pending 期间限制重复操作。地址 `/#/qa?conversation=<id>` 可打开本人会话。刷新/切页返回可恢复，重新提交学生登录表单先清当前选择但不删服务器历史。

pending 时约 1.8 秒同步；会话/用户/页面变化使过期响应失效。最近会话 ID 保存在浏览器，正文和反馈从服务器读。详细归属、幂等和重生成见 [聊天历史](chat-history.md)。

## 流程卡片和操作

只有 type=SERVICE_GUIDE 且 service 非空渲染卡片。条件、材料、步骤、来源来自后端 DTO，下载使用 DTO 地址，申请选实际 service.id。学生和管理员问答支持准备步骤，预览与公开分享只读；进度按账号和事项独立，见 [进度说明](service-progress-v1.1.md)。

材料勾选不自动完成步骤，AI 文本和 currentStep 不决定完成状态。实际申请进度到 /#/my-applications 查看，管理员在 /#/review 审核。卡片个人清单不会自动提交学校业务。

AI 回复支持复制、评价、消息多选分享、重新生成和更多，来源/调试信息折叠展示。当前普通回答底部仅显示一条按可用评分选出的引用，后台保留全部快照；详见 [回答阅读](answer-reading.md)、[分享](chat-share.md) 和 [反馈](ai-reply-feedback.md)。

## 生命周期与验收

离开页面/退出停止对应轮询、计时、动画和监听，避免旧响应写入新页面。存储被禁止时登录和内存进度仍可操作；主题在当前浏览器保存。

按 [统一启动](service-application-startup.md) 打开当前 Vue 页面，检查空/非空对话、历史切换、输入法、键盘、桌面/手机、明暗主题、流程推进与材料、申请弹窗、选中图片/链接分享及撤销。

frontend 目录运行 npm test、npm run build、npm run test:browser；浏览器回归读取实际 dist 并拦截 API，截图位于 tmp/vue-workspace。旧 chat-workspace.live.mjs 不是当前仓库测试入口。当前检查结果见 [文档索引](README.md#本次检查与验证)，真实数据库与模型需另行核查。
