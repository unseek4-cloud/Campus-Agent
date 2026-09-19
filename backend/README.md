# CampusAgent Java Backend

这是 Maven 多模块的 Spring Boot 模块化单体。`campus-app` 是唯一启动模块，其他模块不能自行成为 Spring Boot 应用。

## 构建与启动

```bash
mvn clean package
java -jar campus-app/target/campus-app-0.1.0-SNAPSHOT.jar
```

运行环境通过 `DB_URL`、`DB_USERNAME`、`DB_PASSWORD`、`SERVER_PORT` 配置。知识库检索还使用：

- `AI_SERVICE_BASE_URL`：Python AI 服务地址，默认 `http://localhost:8000`；
- `KNOWLEDGE_DEFAULT_TOP_K`：请求未传 `topK` 时的默认值，默认 5；
- `KNOWLEDGE_MAX_TOP_K`：Java API 允许的最大值，默认 20，应与 AI 服务配置保持一致。

`.env.example` 仅作变量说明，Spring Boot 不会自动读取 `.env` 文件。

健康检查：`GET /api/v1/health`。

知识库检索：`POST /api/knowledge/search`。

```json
{
  "query": "国家奖学金申请需要满足什么条件？",
  "topK": 5
}
```

浏览器仍只访问 Java 后端。`campus-ai-integration` 模块负责校验检索请求并调用
`POST /internal/v1/knowledge/search`，Python 内部地址不会暴露给前端。
