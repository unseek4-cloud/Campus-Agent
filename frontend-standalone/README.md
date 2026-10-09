# CampusAgent · 前端界面（静态版）

高校事务智能问答与办事引导系统的**前端界面**，由 4 个文件组成，零依赖、零构建：

| 文件 | 大小 | 作用 |
| --- | --- | --- |
| `index.html` | 14 KB | 页面骨架：登录页、应用外壳、所有视图容器 |
| `styles.css` | 79 KB | 全部样式（主题变量、响应式、动画） |
| `app.js` | 248 KB | 全部交互逻辑：路由、渲染、后端 API 对接 |
| `data.js` | 17 KB | 静态文案与本地兜底数据（`window.MOCK`） |
| `start.ps1` / `start.bat` | — | 一键启动脚本（自动找 Python、选端口、拉起后端） |

没有 npm、没有打包、没有 `node_modules`：浏览器直接加载源码，改完刷新即可。

---

## 一、快速开始（只跑界面，30 秒）

**Windows**：双击 `start.bat`，脚本会自动选一个空闲端口、启动静态服务并打开浏览器。

**任意系统**（只需 Python 3）：

```bash
cd frontend-standalone
python -m http.server 5500 --bind 127.0.0.1
# 然后浏览器打开 http://localhost:5500/
```

> **不要直接双击 `index.html`。** 用 `file://` 打开时页面没有 origin，后端 Cookie（`CAMPUS_AUTH` / `XSRF-TOKEN`）会被浏览器丢弃，登录永远失败。必须通过 `http://` 访问。

此时界面能完整渲染，但**登录需要后端**（见下一节）：账号密码是后端数据库里的，不在前端文件里。

---

## 二、启动脚本做了什么

```powershell
pwsh -File start.ps1                 # 启动界面 + 尝试拉起后端和 AI 服务
pwsh -File start.ps1 -FrontendOnly   # 只启动界面，不碰后端
pwsh -File start.ps1 -Port 5501      # 指定端口
pwsh -File start.ps1 -NoBrowser      # 不自动开浏览器
```

脚本行为：

1. 在 `PATH` 里找 Python 3（`python` / `python3` / `py`），找不到就提示替代方案后退出；
2. 按 **5500 → 5501 → 3000 → 4173** 顺序挑第一个空闲端口（这几个端口都是后端默认可接受的前端来源，见第三节）；
3. 若脚本位于仓库内（`<repo>/frontend-standalone/`），自动定位并调用仓库自己的 `scripts/start-backend.ps1` 与 `ai-service`；
4. 等待后端 `/api/v1/health` 与 AI `/internal/v1/health` 就绪（最多 60 秒），失败只警告不阻塞；
5. 用 `python -m http.server` 提供静态服务，打印运行摘要，按回车退出并**只关掉自己启动的服务**。

**所有路径都由脚本自身位置推导**，仓库里不存任何开发者的绝对路径；脚本也没有内置账号密码。

前置依赖仅在需要后端/AI 时才要求：

| 想要的功能 | 额外需要 |
| --- | --- |
| 只看界面 | Python 3 |
| 登录、办事项、申请、政策库 | JDK 17+、Maven、MySQL（后端用自己的 `backend/.env`） |
| 智能问答、政策检索 | Python 环境 + `ai-service/requirements.txt` + 大模型 API Key |

---

## 三、跨端口登录：`AUTH_ALLOWED_ORIGINS`（最容易踩的坑）

后端启用了 CORS 白名单且 `Allow-Credentials: true`，**只接受显式列出的来源**。已在运行的后端上实测：

| 页面来源 | `/api/auth/csrf` 结果 |
| --- | --- |
| `http://localhost:5173` | 403（该实例未放行） |
| `http://localhost:5500` | 200 + `Access-Control-Allow-Origin: http://localhost:5500` |
| `http://localhost:9999` | 403 |
| `http://evil.example.com` | 403 |

也就是说：**页面从哪个端口打开，那个端口就必须在后端白名单里**，否则 CSRF、登录、所有接口全部 403，界面停在登录页。

默认白名单是 `http://localhost:5173,http://127.0.0.1:5173`（Vue 版开发端口）。要让静态版在 5500 上登录：

```powershell
# 方式一：写进 backend/.env（推荐）
cd backend
Copy-Item .env.example .env      # 首次
# 编辑 .env，追加端口（逗号分隔，不要有空格）
# AUTH_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:5500,http://127.0.0.1:5500
```

```powershell
# 方式二：当前会话临时生效
$env:AUTH_ALLOWED_ORIGINS = "http://localhost:5500,http://127.0.0.1:5500"
.\scripts\start-backend.ps1
```

改完**必须重启后端**（配置在启动时读取）。注意事项：

- 用 `localhost` 打开页面就写 `localhost`，用 `127.0.0.1` 打开就写 `127.0.0.1` —— 二者是不同的 origin，不会互相匹配；
- **不要**为了省事把白名单写成 `*`：后端开了 `Allow-Credentials`，通配符会带来跨站请求伪造风险，也会被浏览器拒绝；
- 前端 `app.js` 会按页面主机名推导后端地址（`http://<页面主机>:8080`），所以页面在 `localhost` 上时后端也必须是 `localhost`，混用会导致「登录成功却立刻跳回登录页」；
- 需要指向别的后端地址时，在加载 `app.js` 之前设置全局变量即可：

  ```html
  <script>window.CAMPUS_API_BASE = "http://192.168.1.10:8080";</script>
  <script src="data.js"></script>
  <script src="app.js"></script>
  ```

---

## 四、后端接口契约

`app.js` 只依赖下面这些接口（Cookie + CSRF 双令牌）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/auth/csrf` | 取 CSRF token；`XSRF-TOKEN` Cookie 是 `HttpOnly`，JS 读不到，必须从响应体取 |
| `POST` | `/api/auth/login` | `{ username, password }`，需带 CSRF 头 |
| `GET` | `/api/auth/me` | 会话有效时返回当前用户 |
| `POST` | `/api/auth/logout` | 需带 CSRF 头 |
| `POST` | `/api/auth/change-password` | 首次登录强制改密；⚠️ **仓库当前后端尚未实现该端点**，详见下方说明 |
| `GET` | `/api/v1/health` | 健康检查（`start.ps1` 用它判断后端是否就绪） |
| `GET` | `/api/share/chat/{token}` | 公开分享页，只读、无需登录 |

其余业务接口按角色分区，均需要登录态：

| 前缀 | 用途 |
| --- | --- |
| `/api/chat/conversations/**` | 问答会话历史、生成/撤销分享链接 |
| `/api/rag/chat`、`/api/knowledge/search` | 智能问答、政策检索（依赖 `ai-service`） |
| `/api/services/**` | 办事事项列表 / 详情 / 事项识别 |
| `/api/student/applications/**` | 学生申请提交、材料上传、进度、撤回重提 |
| `/api/admin/**` | 管理员：总览、政策文档、事项与材料维护、申请审核配置 |
| `/api/files/{id}/download` | 材料模板与附件下载 |

返回结构统一为 `{ code, message, data, requestId }`。前端对 `401`（登录过期）、`403 CSRF_INVALID`（页面验证过期）、`403 MUST_CHANGE_PASSWORD`（需改初始密码）都有专门的兜底提示与重试逻辑。

> **⚠️ 集成依赖（首次登录必读）**
> 前端登录后会调用 `POST /api/auth/change-password` 完成「初始密码强制修改」流程，但当前仓库后端（`campus-identity/AuthController`）只实现了 `csrf` / `login` / `me` / `logout`，**没有该端点**。因此：
>
> - 账号 `mustChangePassword = false` 时，登录与全部功能正常；
> - 账号被标记为必须改密时，修改密码会失败并提示「你没有权限访问该页面」。
>
> 若需要这条流程，后端需补上该端点（返回 `MUST_CHANGE_PASSWORD` 错误码与改密接口），前端已按此契约实现、无需改动。

---

## 五、与仓库里 Vue 版前端的关系

仓库里有两套前端，**互不影响、可同时保留**：

| | `frontend/`（Vue 版） | `frontend-standalone/`（本目录） |
| --- | --- | --- |
| 技术栈 | Vue 3 + Vite + TypeScript + Element Plus | 原生 HTML / CSS / JS，无构建 |
| 启动 | `npm install && npm run dev`（:5173） | `start.bat` 或 `python -m http.server`（:5500） |
| 默认后端白名单 | 已包含 5173 | 需自行加入 5500 |
| 独立可运行 | 需要 Node 与依赖安装 | 只要 Python 3（或任意静态服务） |

两者都对接同一套后端 API，功能覆盖一致，可按演示场景任选其一。

---

## 六、常见问题

**页面能开，登录一直失败 / 控制台一堆 403**
→ 第三节：把当前页面端口加进 `AUTH_ALLOWED_ORIGINS` 并重启后端。

**登录返回「登录成功」但立刻回到登录页**
→ 页面主机名与后端主机名不一致（`localhost` vs `127.0.0.1`）。统一用 `localhost`，或按第二节设置 `CAMPUS_API_BASE`。

**提问时提示「AI 服务不可用」**
→ `ai-service` 没起来或 8000 端口不通。首次启动会下载 embedding / rerank 模型，可能较慢；离线环境可设 `HF_ENDPOINT=https://hf-mirror.com` 或 `HF_HUB_OFFLINE=1`（`start.ps1` 已默认带上 offline 变量）。其余功能不受影响。

**5500 被占用**
→ `start.ps1` 会自动换端口（5501 / 3000 / 4173），但这些端口同样要在后端白名单里；也可以 `-Port 自定义`。

**改了 `styles.css` / `app.js` 不生效**
→ 强制刷新（`Ctrl+F5`），静态服务没有构建缓存但浏览器有。

---

## 七、部署说明

这个前端**不是可直接公开托管的纯静态站点**：页面依赖同站 Cookie 与 CSRF 双令牌，登录、数据全部来自后端，且后端 CORS 只放行显式白名单中的来源。

- **本地/局域网演示（推荐）**：用 `start.ps1` 或 `python -m http.server` 在能访问后端的机器上跑，最省事。
- **放到 GitHub Pages 之类的外部域名**：前端页面能打开，但登录必然失败（域名不在后端 `AUTH_ALLOWED_ORIGINS` 内，且 `SameSite=Lax` Cookie 不会跨站发送）。要真部署，需把前端与后端放在同一站点下由后端托管，或把部署域名加入白名单并启用 HTTPS Cookie（`AUTH_COOKIE_SECURE=true`）。
- 生产部署前请清理示例数据、调试开关与测试账号。

---

## 八、许可与用途

本目录为课程项目的前端实现，供学习与演示使用。
