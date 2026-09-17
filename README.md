# CampusAgent

CampusAgent 是面向高校学生的事务智能问答与办事引导系统。本仓库当前仅包含可独立启动的基础骨架，不包含具体业务实现。

## 项目结构

```text
frontend/     Vue 3 + Vite + Element Plus + Axios
backend/      Java 21 + Spring Boot 3 + MyBatis-Plus + MySQL
ai-service/   Python + FastAPI
docs/         项目文档
deploy/       部署配置预留目录
scripts/      开发和运维脚本预留目录
```

## 环境要求

- Node.js 20.19+ 或 22.12+
- npm 10+
- JDK 21
- Maven 3.6.3+
- Python 3.11+
- MySQL 8.x

## 启动前端

```bash
cd frontend
npm install
npm run dev
```

默认地址：`http://localhost:5173`。

## 启动 Java 后端

先创建数据库并配置环境变量：

```sql
CREATE DATABASE campus_agent CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

PowerShell 示例：

```powershell
$env:DB_URL = "jdbc:mysql://localhost:3306/campus_agent?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true"
$env:DB_USERNAME = "campus_agent"
$env:DB_PASSWORD = "replace-me"
cd backend
mvn clean package
java -jar campus-app/target/campus-app-0.1.0-SNAPSHOT.jar
```

健康检查：`http://localhost:8080/api/v1/health`。

## 启动 AI 服务

PowerShell 示例：

```powershell
cd ai-service
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Linux/macOS 示例：

```bash
cd ai-service
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：`http://localhost:8000/internal/v1/health`，OpenAPI 文档：`http://localhost:8000/docs`。

## 当前边界

- 浏览器只访问 Java 后端，不直接访问 AI 服务。
- Java 后端负责业务、权限和 MySQL 数据。
- Python 服务只承载 AI 能力；当前仅提供基础配置和健康检查。
- 业务模块只能通过公开契约协作，禁止跨模块访问 Mapper、Entity 或数据表。

