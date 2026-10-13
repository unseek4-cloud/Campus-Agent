# CampusAgent · Vue 前端

项目只保留这一套前端：Vue 3、Vue Router、Vite。原静态版的全部样式和业务功能已迁入，旧 Vue 页面与 `frontend-standalone` 已移除。

回复不佳支持多选原因和选填说明；侧边栏个人入口展开资料、主题切换和退出登录。完整的三服务启动方式与验收步骤见 [反馈和个人菜单验收说明](../docs/feedback-profile-acceptance.md)。

政策上传后显示真实处理进度，完成后自动更新列表并提示成功或失败，详见 [政策上传进度验收说明](../docs/policy-upload-progress.md)。

回答支持标题、加粗和列表等 Markdown 排版；只显示最相关的一条引用，并可打开原文件；管理员首页自动加载最近对话。见 [回答阅读与引用验收说明](../docs/answer-reading.md)。

启动：

```powershell
cd frontend
npm ci
npm run dev
```

默认打开 `http://127.0.0.1:5173/`。Windows 也可以双击 `start.bat` / `启动.bat`，脚本自动选择端口，并尝试启动尚未运行的 Java 和 AI 服务。只启动前端使用 `powershell -File start.ps1 -FrontendOnly`。

开发时 `/api` 通过 Vite 代理到 `http://127.0.0.1:8080`，保留 Cookie、CSRF 和既有后端接口；独立部署可用 `.env` 中的 `VITE_API_BASE` 指定后端源。生产部署需要将 `/api` 反向代理到后端，构建产物为 `dist/`。

```powershell
npm run build       # Vue 类型检查与生产构建
npm test            # 进度逻辑和回答渲染测试
npm run test:browser # 构建后运行浏览器功能与布局回归
```

浏览器测试使用 npm 中的 `playwright-core` 与 Windows Edge；其他环境设置 `BROWSER_EXECUTABLE`。测试拦截 API 并使用测试数据，不修改学校资料、用户账户或申请记录。

源码结构：

| 位置 | 用途 |
| --- | --- |
| `src/App.vue`、`src/router.ts` | Vue 生命周期、登录状态、页面路由与浏览器历史 |
| `src/components/` | 登录、应用外壳、问答工作区、页面容器与分享外壳 |
| `src/styles/` | 完整共用样式、明暗主题、响应式规则 |
| `src/workspace/` | API、问答、分享、材料、管理功能及特殊交互模块 |
| `src/modules/serviceguide/` | 直接复用经过测试的 TypeScript 办事进度逻辑 |

页面容器由 Vue 路由管理。迁入的业务模块在容器内渲染列表、结构化卡片及弹窗；Canvas 图片导出和特殊动画保留既有实现。页面退出与组件卸载会停止相应计时器、事件监听和动画。

迁移记录及验证结果见 [Vue 统一前端说明](../docs/ui-vue-migration.md)。
