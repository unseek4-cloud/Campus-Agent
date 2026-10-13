# CampusAgent 部署说明

目前仓库支持三个应用分别启动和前端生产构建，本目录没有 Dockerfile、Docker Compose、Nginx 配置或经过验证的生产部署脚本。下面说明代码已有的运行要求，容器化、反向代理具体文件和新机器部署结果仍待补充。

## 可用的构建和启动方式

Java 在 `backend` 目录构建：

```powershell
mvn package
java -jar campus-app/target/campus-app-0.1.0-SNAPSHOT.jar
```

直接运行 JAR 前需向进程提供 [后端配置](../backend/README.md#运行配置)，Spring Boot 不读取 `backend/.env`。Windows 本地可用仓库根目录的 `scripts/start-backend.ps1 -Build` 加载配置并启动。

Python 在 `ai-service` 目录、已安装依赖的虚拟环境中启动：

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

保持一个 worker。处理进度、模型实例、信号量和本地 Chroma 均按单进程装配；当前没有多实例任务协调或共享进度存储。CLI 的 host/port 控制监听地址，`AI_HOST`、`AI_PORT` 在当前 main.py 中不会自动配置 Uvicorn。

前端在 `frontend` 目录运行 `npm ci`、`npm run build`，静态产物是 `dist/`。正式 Web 服务需要提供这些文件，并将 `/api` 转发到 Java；Vite 开发代理不会进入构建产物。前端采用 hash 路由，`/#/qa` 和 `/#/share/<token>` 的 hash 不发送给服务器。

## 网络和认证

同机运行时 Java 默认 8080，Python 默认示例端口 8000。Java 通过 `AI_SERVICE_BASE_URL` 访问 Python；不同主机部署时应改为实际内部地址，并限制可达范围。Python 内部接口目前没有调用方鉴权，不能仅因路径含 internal 就认定接口受保护。

认证 Cookie 使用 `HttpOnly; SameSite=Lax; Path=/api`。HTTPS 环境设置 `AUTH_COOKIE_SECURE=true`，`AUTH_ALLOWED_ORIGINS` 填实际来源。推荐页面与 API 同源。单独后端 origin 可由 `VITE_API_BASE` 在构建时配置，但任意跨站域名组合不保证符合当前 Cookie 策略，需要实际验证。

Java 启动前必须提供有效的 `JWT_SECRET` 和数据库连接。新库建表、旧库 V2 升级和账号创建见 [完整启动说明](../docs/service-application-startup.md)。数据库需预先创建；应用启动不会创建默认用户。质量分析权限需按 [反馈说明](../docs/ai-reply-feedback.md) 另行授予。

## 持久化与恢复

| 数据 | 默认位置 | 用途 |
| --- | --- | --- |
| 业务数据 | MySQL `campus_agent` | 账号、事项、申请、历史、分享、评价及文档元数据 |
| 知识原文件 | Java 工作目录下 `var/documents` | 来源下载、重新解析 |
| 模板附件 | 上述目录的 `materials/` | 事项材料表格下载 |
| 申请附件 | 上述目录的 `applications/` | 私有申请证据，按角色和归属下载 |
| 向量索引 | `ai-service/var/chroma` | Chunk、向量和来源元数据 |
| 模型缓存 | 第三方库采用的本地缓存 | 冷启动准备，具体路径待部署环境确认 |

使用仓库启动脚本时，Java 工作目录是 backend，因此文件在 `backend/var/documents`。生产环境可通过 `ADMIN_DOCUMENT_STORAGE_PATH`、`MATERIAL_UPLOAD_DIR`、`APPLICATION_UPLOAD_DIR` 和 `AI_VECTOR_STORE_PATH` 指向持久化目录。

MySQL、原文件和向量库没有统一事务，应协调备份，保持文档 ID 与文件一致。本地 Chroma 备份宜在停止写入后进行。索引可以由原文件重新解析重建，但耗时和恢复步骤需在独立环境演练。重建目前会先删除旧文档向量，失败后不能自动恢复旧索引。

Java 重启会把处理中记录标为失败，需要管理员重新解析；没有自动继续队列任务。检查孤立文件、失败向量、恢复可用性仍是运维待补充项，本次没有执行备份或恢复。

## 部署验收

两个健康接口只能确认进程响应。部署后还需实际完成登录、上传、处理进度、检索、千问回答与来源、申请补交审核和公开分享，并测试权限。没有 Key 时普通检索仍可用，有证据的生成会报 `LLM_NOT_CONFIGURED`；云模型故障不能当成知识库无资料。

当前尚未确认生产机器配置、域名、证书、资料授权、模型缓存、负载容量和备份计划。校内真实业务接入、政策版本治理、多知识库授权和页面私有附件链接问题见 [检查记录](../docs/README.md#文档检查与待确认项)。
