# CampusAgent 登录与账号管理

账号来自 MySQL 的 user_account，角色只有 STUDENT 和 ADMIN。没有注册、学校统一身份登录、找回密码或后端自助改密接口。前端虽然保留强制初始改密表单和文案，当前 AuthController/UserView 未实现对应契约，不能列为已完成功能。

## 登录与权限

1. 页面启动 GET /api/auth/me 恢复身份，匿名时显示同一页面的登录表单。
2. 写操作前 GET /api/auth/csrf，保留 Cookie 和返回的 token/headerName。
3. POST /api/auth/login 提交 username/password。参数化 SQL 查账号，BCrypt 校验，错误账号/密码统一返回 BAD_CREDENTIALS；正确密码且账号禁用返回 ACCOUNT_DISABLED。
4. Java 保存可撤销登录会话，签发 HS256 JWT 到 CAMPUS_AUTH Cookie。响应只返回 success 和 UserView，不返回密码、哈希或 JWT。
5. 每次请求校验 JWT、有效期、会话、账号状态和密码指纹，并重新读取数据库角色。
6. POST /api/auth/logout 撤销当前会话、清 Cookie。登录和退出均清理 CSRF Cookie，API 客户端随后重新获取 token。

Cookie：HttpOnly、SameSite=Lax、Path=/api，默认有效期 120 分钟；CSRF Cookie 也为 HttpOnly，前端从接口取校验值。页面使用 fetch credentials=include，没有 Axios 客户端，也不把 JWT 放到 localStorage。

| 路径 | 权限 |
| --- | --- |
| GET /api/v1/health、GET /api/auth/csrf | 公开 |
| GET /api/share/** | 公开只读 token；没有匿名写操作 |
| POST /api/auth/login、logout | 不要求已有身份，但需 CSRF |
| GET /api/auth/me | 已登录 |
| /api/admin/** | ADMIN |
| /api/student/** | STUDENT |
| 其他 /api/** | STUDENT 或 ADMIN |
| Java 非 API 路径 | 默认拒绝，前端由 Vite/Web 服务提供 |

前端登录没有单独 /login 路由，学生进入 /#/qa、管理员进入 /#/dashboard。菜单隐藏和页面跳转只是体验保护，最终权限由 [SecurityConfiguration.java](../backend/campus-identity/src/main/java/com/campusagent/identity/security/SecurityConfiguration.java) 决定。

公共聊天和模板下载允许两种角色；个人历史仍按用户归属，不给 ADMIN 读取别人会话的特例。申请由 STUDENT 创建，ADMIN 审核；质量分析还需显式数据范围，见 [反馈授权](ai-reply-feedback.md#管理员数据范围)。Python 内部接口不使用浏览器 Cookie，需部署网络限制。

## 表与配置

user_account 的 username（最长 80）和非空 student_no（最长 40）唯一；display_name 最长 120；password_hash 为 60 字符 BCrypt；role=STUDENT/ADMIN，status=ACTIVE/DISABLED。账号大小写比较取决于实际数据库排序规则，不能把开发库状态作为所有环境事实。

user_login_session 保存 UUID、user_id、已加盐密码哈希的 SHA-256 指纹和过期时间，不保存明文密码/原始 JWT。登录时清理过期会话，改密使旧指纹不匹配，退出删除当前会话。V5 启动建表，V11 添加可选 user_profile。建表和旧库升级见 [后端数据库说明](../backend/README.md#数据库设计与升级)。

JWT_SECRET 必须是至少 32 随机字节的 Base64，缺失/无效拒绝启动；JWT_EXPIRE_MINUTES 默认 120。生产 HTTPS 使用 AUTH_COOKIE_SECURE=true，来源列表按实际前端设置 AUTH_ALLOWED_ORIGINS。完整准备及兼容 PowerShell 的随机密钥命令见 [启动说明](service-application-startup.md#创建数据库与配置)。

Spring Boot 不自动读取 backend/.env；仓库启动脚本读取。旧 ADMIN_USERNAME/ADMIN_PASSWORD 不再是服务端身份来源。前端配置为 VITE_API_BASE（后端 origin 或空），不是旧 VITE_API_BASE_URL。

## 创建本地测试账号

从仓库根目录，后端已构建且启动过完成建表后执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\manage-accounts.ps1 -Action Seed
```

工具显式创建缺失的 admin、20260001、20260002，打印各自随机密码；已有账号跳过，不重置。不会自动保存到 tmp 凭据文件。后续新 ADMIN 如需质量分析仍要授权。不要把这些账号当成默认生产用户。

## 添加与维护账号

SQL 在 MySQL 客户端执行，PowerShell 命令在终端执行。添加、禁用、改密等正常维护无需重编译 Java。

### 生成 BCrypt

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\manage-accounts.ps1 -Action Hash
```

工具从控制台/标准输入取密码，没有 Web endpoint，也不连接数据库。使用 BCrypt cost=10，密码最多 72 个 UTF-8 字节。每次随机盐不同，相同密码可得到不同哈希。

直接工具方式在 backend 目录：

```powershell
java '-Dloader.main=com.campusagent.identity.tools.PasswordHashTool' -cp campus-app/target/campus-app-0.1.0-SNAPSHOT.jar org.springframework.boot.loader.launch.PropertiesLauncher
```

### 新增学生与管理员

先把下列 password_hash 占位内容替换为工具输出的完整哈希，再执行选中的语句；占位值不满足数据库约束。

```sql
INSERT INTO user_account(username,password_hash,display_name,role,student_no,status)
VALUES ('实际学生账号','替换为完整BCrypt哈希','实际姓名','STUDENT','实际学号','ACTIVE');

INSERT INTO user_account(username,password_hash,display_name,role,student_no,status)
VALUES ('实际管理员账号','替换为完整BCrypt哈希','实际姓名','ADMIN',NULL,'ACTIVE');
```

管理员学号用 SQL NULL，不是字符串 'NULL'。username/学号重复时先查询，不删除未知用户绕过唯一约束。教学 SQL 文件 [account_templates.sql](../backend/campus-app/src/main/resources/db/seed/account_templates.sql) 中保留弱密码示例，不自动加载，也不应整份运行。

### 查看、禁用与启用

```sql
SELECT id,username,display_name,role,student_no,status,created_at,updated_at
FROM user_account ORDER BY id;

UPDATE user_account SET status='DISABLED' WHERE username='实际账号';
DELETE FROM user_login_session WHERE user_id=(SELECT id FROM user_account WHERE username='实际账号');

UPDATE user_account SET status='ACTIVE' WHERE username='实际账号';
```

日常查询不输出 password_hash。仅 DISABLED 会在下次请求拒绝账号；重新 ACTIVE 后尚未过期的旧会话可能恢复，所以需要强制重新登录时同时删除登录会话。

### 重置密码与可选资料

```sql
UPDATE user_account SET password_hash='替换为新密码的完整BCrypt哈希' WHERE username='实际账号';
DELETE FROM user_login_session WHERE user_id=(SELECT id FROM user_account WHERE username='实际账号');

INSERT INTO user_profile(user_id,department,major,class_name)
SELECT id,'实际院系','实际专业','实际班级' FROM user_account WHERE username='实际学生账号'
ON DUPLICATE KEY UPDATE department='实际院系',major='实际专业',class_name='实际班级';
```

密码重置不会自动启用账号。资料只有读取接口，没有个人资料编辑 API。前端空字段会采用虚构兜底，需按 [个人菜单说明](feedback-profile-acceptance.md#个人资料来源) 核对展示。

### 删除测试账号

优先停用。真正删除前查清申请和事件关联；user_account 的登录/聊天/反馈等部分关联可级联，但申请归属和操作人外键会阻止删除。不要为删除用户清空业务记录或关闭外键约束。

仅对确认没有相关业务的测试账号执行：

```sql
SELECT id,username,role,status FROM user_account WHERE username='确认可删除的测试账号';
DELETE FROM user_account WHERE username='确认可删除的测试账号';
```

## 验收与测试

按 [统一启动](service-application-startup.md) 准备 MySQL、JWT、账号和三个应用。验证错误密码、禁用/恢复、刷新、退出后旧 Cookie、学生/管理员 API 分流、缺 CSRF、两个用户聊天归属，以及资料不含密码/JWT。前端个人入口位于侧栏底部，旧“右上角账号”验收描述不再适用。

在 backend 运行 `mvn test`，在 frontend 运行 `npm test`、`npm run build`、`npm run test:browser`。AuthIntegrationTest 使用 H2 和真实安全过滤链，不访问学校 MySQL；浏览器回归用拦截的 API。当前不存在旧 auth.e2e.mjs/materialAttachments.e2e.mjs 等脚本，不沿用其命令。

本次只核对文档和代码，未修改真实账号或登录配置，完整检查结果见 [文档索引](README.md#本次检查与验证)。学校统一身份、登录限流、自助改密和找回密码属于后续工作。
