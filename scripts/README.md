# CampusAgent 脚本说明

本目录已有启动、账号维护、验收和校园资料工具。下面的命令均从仓库根目录执行；凭据使用本地环境或交互输入，不能写入仓库。

| 脚本 | 用途和前置条件 |
| --- | --- |
| `start-backend.ps1` | 读取 backend/.env，在 backend 工作目录运行 JAR；`-Build` 或没有 JAR 时执行 mvn package |
| `manage-accounts.ps1` | `-Action Hash` 运行 BCrypt 工具；`-Action Seed` 显式创建缺失的本地测试账号，需已有 JAR 和初始化后的数据库 |
| `test-service-guide.ps1` | 登录后验证示例事项识别、结构化问答与 404，需后台运行、事项已导入 |
| `create-material-test-fixtures.py` | 使用 Python 标准库生成一个最小 DOCX 到 tmp/material-fixtures，不上传 |
| `test-reply-feedback-live.mjs` | 临时 MySQL + Java + Vue 浏览器联调，AI 为 HTTP 测试替身 |
| `campus_library/` | 文档生成、渲染、导入、访问核验及导出，见 [资料工具说明](campus_library/README.md) |

## 常用命令

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1 -Build
```

```powershell
# 另一个终端，在后端完成建表后显式初始化本地账号
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\manage-accounts.ps1 -Action Seed
```

Hash 操作不访问数据库；Seed 从 backend/.env 读取数据库连接，创建 admin、20260001、20260002 并仅在终端打印新账号的随机密码，已有账号会跳过。后端每次启动不会自动 Seed。账号 SQL 和禁用/改密说明见 [认证文档](../docs/auth-rbac.md)。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-service-guide.ps1 -BaseUrl http://127.0.0.1:8080
```

提示输入的是 CampusAgent 登录账号，不是 MySQL 连接账号；脚本提示中的 database account 容易混淆。它会通过 /api/rag/chat 创建验收会话，当前脚本不负责删除这些记录。重新运行离线降级检查时，其他服务保持可用。

## 反馈真实联调脚本

先在 frontend 安装依赖，在 backend 构建 JAR，准备 MySQL CLI 和可创建/删除临时数据库的本地账号，再执行：

```powershell
node scripts/test-reply-feedback-live.mjs
```

脚本读取 backend/.env，也接受 `DB_URL`、`DB_USERNAME`、`DB_PASSWORD` 覆盖；`MYSQL_BINARY` 指定 mysql，`BROWSER_EXECUTABLE` 指定浏览器，`PLAYWRIGHT_MODULE_PATH` 指定 Playwright Core 模块。实际端口为 18080（Java）、18000（AI 替身）、15173（Vue），需空闲。

它创建 `campus_feedback_test_<时间戳>`，finally 中关闭本次服务并删除该临时库；日志、截图在 `tmp/feedback-browser/`。不运行真实 Qwen，也不能据此证明真实 AI 质量。本次文档更新没有执行该脚本或修改数据库。

通常的前端浏览器回归入口是 frontend 目录的 `npm run test:browser`，旧静态目录下的脚本已删除，不能继续使用旧文档中的命令。
