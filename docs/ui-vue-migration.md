# 前端统一与 Vue 迁移说明

当前唯一维护入口是 frontend，旧静态目录和旧 Vue 业务页面已移除。本文按 2026-10-13 的实际代码说明迁移后的结构，不把此前两套界面验证结论当成当前结果。

Vue SFC 承载登录、应用外壳、个人菜单和问答布局，Vue Router 使用 createWebHashHistory 管理 /#/qa 等页面、会话 query 与公开分享。src/workspace 的原生 JavaScript 负责 fetch/CSRF、业务视图、材料、审核、反馈、Canvas 图片和特殊交互；当前没有 Element Plus、Axios 依赖。

进度直接导入 src/modules/serviceguide/services/serviceProgress.ts，service-guide.js 给存储键增加账号前缀并在身份变化时重建 store。没有静态生成副本或同步脚本。样式由 src/styles/index.css 统一引入，明暗主题、响应式布局使用同一组变量。

## 保留的业务与实际边界

接口继续使用 Cookie、CSRF、消息 ID、UUID 去重、权限范围、要求快照、模板与公开分享契约。申请、补交、详情和审核在弹窗中完成；当前页面路由与旧 /admin/services、/knowledge/search 不兼容，入口表见 [前端 README](../frontend/README.md)。

离页/卸载清理轮询、事件监听、计时和动画。管理员问答和学生问答都可保存本地准备清单，管理员事项预览和公开分享只读。学生主动登录默认新对话，服务器历史保留；管理员首页加载本人最近对话。

迁移并不证明所有契约一致。当前仍存在前端改密文案无后端实现、申请私有附件按钮路径不一致、政策列表只加载前 100 条等边界，见 [检查记录](README.md#文档检查与待确认项)。

## 复验入口

在 frontend 运行 npm ci、npm test、npm run build、npm run test:browser。浏览器测试读取实际 dist 并模拟后端 DTO，覆盖工作区、反馈、进度、来源、材料、审核、服务状态和视觉布局。测试样本不是学校政策，不能将窄屏模拟当成全部手机实机验证。

本次前端 31 项单元测试和类型检查/生产构建通过；完整浏览器、真实 Java/MySQL/Qwen 和跨浏览器验收未重跑，实际范围统一见 [索引](README.md#本次检查与验证)。不再保留无当前证据的逐像素一致、固定浏览器检查数或启动实测结论。

启动、环境变量、脚本参数、构建产物和部署要求见 [前端说明](../frontend/README.md)。
