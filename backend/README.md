# CampusAgent Java Backend

这是 Maven 多模块的 Spring Boot 模块化单体。`campus-app` 是唯一启动模块，其他模块不能自行成为 Spring Boot 应用。

## 构建与启动

```bash
mvn clean package
java -jar campus-app/target/campus-app-0.1.0-SNAPSHOT.jar
```

运行环境通过 `DB_URL`、`DB_USERNAME`、`DB_PASSWORD`、`SERVER_PORT` 配置。`.env.example` 仅作变量说明，Spring Boot 不会自动读取 `.env` 文件。

健康检查：`GET /api/v1/health`。

