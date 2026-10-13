# CampusAgent Vue 前端

`frontend/` 是当前唯一前端。Vue 负责组件生命周期，Vue Router 管理 hash 路由；`src/workspace/` 负责 API、业务视图、弹窗及交互。实际依赖为 Vue、Vue Router、Vite 和 TypeScript，没有 Element Plus、Axios 或单独静态前端。

## 安装与启动

在仓库根目录执行：

```powershell
Set-Location frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Node 版本声明为 `>=20.19.0`，依赖版本和 npm scripts 见 [package.json](package.json)。开发服务器默认监听 `127.0.0.1:5173`，`/api` 代理至 `http://127.0.0.1:8080`，配置见 [vite.config.ts](vite.config.ts)。

Windows 可运行 `start.bat`、`启动.bat` 或 `start.ps1`。脚本缺少 node_modules 时执行 npm ci，依次尝试 5173、5500、5501、4173；可通过 `-Port` 指定端口。它检查两个健康接口并尝试启动 Java 和 AI，但数据库、JWT、Python 环境及模型需提前准备。Java 已有 JAR 时不会自动重建。

```powershell
# 在 frontend 目录，仅启动界面
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -FrontendOnly -NoBrowser
```

其他参数为 `-SkipBackend`、`-SkipAi`。日志写入 `frontend/logs/`。脚本中按 Enter 只停止本次前端进程；后台启动的 Java、AI 仍继续运行。

## 页面和源码

当前入口采用 `/#/qa`、`/#/search`、`/#/affairs`、`/#/my-applications`；管理员入口为 `/#/dashboard`、`/#/policy-mgr`、`/#/services-mgr`、`/#/review`、`/#/ai-quality`、`/#/audit`、`/#/settings`。公开分享为 `/#/share/<token>`。登录是同一页面的界面状态；申请创建与详情是弹窗，没有旧版 `/student/services/:id/apply` 等页面路由。以 [router.ts](src/router.ts) 为准。

| 位置 | 职责 |
| --- | --- |
| `src/App.vue`、`src/router.ts` | 装配 workspace、路由、会话 query 和公开分享 |
| `src/components/` | 登录、侧栏外壳、个人菜单、问答布局、页面容器 |
| `src/workspace/workspace.js` | fetch/CSRF、登录状态、问答与各管理视图 |
| `src/workspace/service-guide.js` | 结构化卡片、用户隔离和进度交互 |
| `src/modules/serviceguide/services/serviceProgress.ts` | 进度恢复、版本校验和确定性步骤算法 |
| `src/workspace/chat-rendering.js`、`answer-markdown.js`、`chat-sources.js` | 回答排版和单条最佳来源 |
| `src/workspace/reply-feedback.js`、`ai-quality.js` | 用户反馈和管理员质量统计 |
| `src/workspace/application-materials.js`、`document-progress.js` | 材料逐项选择、政策处理轮询 |
| `src/styles/index.css` | 样式入口、主题、布局和响应式规则 |

浏览器请求带 `credentials: include`。写请求从 `/api/auth/csrf` 获取 header/token，登录和退出后清理缓存；401 回登录，CSRF 失效可重新获取并重试一次。Cookie 和数据库角色是权限依据，菜单隐藏只是界面提示。

`VITE_API_BASE` 默认为空，表示同源访问。源码还支持 `window.CAMPUS_API_BASE` 覆盖；两者都填写后端 origin，例如 `https://campus-api.example.edu`，不能填写 `/api`，否则拼接会重复。示例配置见 [.env.example](.env.example)，更改 Vite 环境变量后需重新启动或构建。

## 构建与测试

```powershell
npm test
npm run build
npm run test:browser
```

build 先运行 vue-tsc，再生成 `dist/`。test 使用 Node 测试运行器，覆盖步骤进度和回答渲染。浏览器脚本读取构建产物并拦截接口，覆盖历史、分享、反馈、政策进度、来源、申请和布局，不依赖实际学校数据库。默认使用本机 Edge；可设置 `BROWSER_EXECUTABLE`，部分脚本支持 `PLAYWRIGHT_MODULE_PATH`。测试资源通过 `npm ci` 安装的 playwright-core 提供。

`npm run preview` 只预览构建产物，当前配置没有 preview 的 `/api` 代理；实际业务访问还需后端 origin 或反向代理，不能把预览启动成功等同于完整系统部署成功。详细部署见 [部署说明](../deploy/README.md)。

## 已知边界

学生主动登录后进入空白新对话，历史保留在服务器；刷新或从其他页面返回可按会话 ID 恢复。管理员首页会加载本人最近对话。准备清单按账号和事项存于浏览器，不跨设备同步。个人资料缺字段时有虚构兜底，不应作为真实学籍数据。

前端保留强制改密表单和说明，但 Java 未提供对应接口和账号状态；申请附件部分按钮链接使用模板下载路径，与后端私有附件接口不符。本次只记录问题，未修改代码，详见 [检查记录](../docs/README.md#文档检查与待确认项)。

交互说明见 [问答工作区](../docs/chat-workspace.md)、[回答阅读](../docs/answer-reading.md)、[政策进度](../docs/policy-upload-progress.md) 和 [个人菜单](../docs/feedback-profile-acceptance.md)。
