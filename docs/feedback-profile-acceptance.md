# 回复反馈与个人菜单验收

当前统一 Vue 前端中，回复不佳弹窗支持七种原因多选和选填说明，最多 2000 字符；再次选择不佳编辑，更多操作可取消。用户原因与管理员分类/备注分开保存。完整 API、授权和统计见 [反馈说明](ai-reply-feedback.md)。

侧栏底部显示头像、姓名和角色，点击展开个人资料、明亮/深色主题和退出。学生显示学号、专业、班级、院系；管理员显示部门。菜单支持 Esc/遮罩关闭和键盘焦点。

## 个人资料来源

姓名、账号、角色和学号来自 user_account；可选 department/major/class_name 来自 V11 的 user_profile。前端缺字段时使用四组固定虚构学生资料，管理员空部门兜底“信息化建设与管理处”；这些只在显示时合并，不写数据库，也不是真实学籍。

没有个人编辑接口。维护真实资料时，由数据库维护者替换实际账号与内容：

```sql
INSERT INTO user_profile(user_id,department,major,class_name)
SELECT id,'实际院系','实际专业','实际班级' FROM user_account WHERE username='实际学生账号'
ON DUPLICATE KEY UPDATE department='实际院系',major='实际专业',class_name='实际班级';
```

重新读取 /api/auth/me（如重新登录）后生效。管理员只需维护 department。部署/展示前需核对空资料的虚构兜底，不能作为项目成果或真实用户数据。

## 启动和预期行为

完整准备见 [三服务启动](service-application-startup.md)。V11/V12 随 Java 初始化，不需要重建业务库。当前页面地址 /#/qa、/#/ai-quality，登录表单在应用根页，不是 /login。

首次主题默认明亮，用户手动选择保存在 localStorage 的 ca-theme；登录界面始终明亮，已保存主题进入主应用后恢复。学生主动登录先进入空白对话，历史可手动打开；刷新当前会话可恢复。

## 手工核查

1. 学生和管理员分别登录，打开个人菜单，对照真实账号与可选资料；空字段的展示兜底须明确了解其来源。
2. 对已保存回答打开不佳弹窗，只选原因或只填说明均可，提交后重新打开/刷新检查恢复；修改后管理员旧分类应重置。
3. Esc、关闭按钮、遮罩不提交；更多取消会删除当前评价，原回答保留。
4. 个人菜单切主题、刷新、退出，登录页恢复明亮；检查手机不横向溢出、键盘焦点可达。
5. 有权限的管理员质量分析可查看用户原因/说明，继续填写独立的分类和处理备注。

## 自动覆盖

在 frontend 目录：

```powershell
npm test
npm run build
node tests/browser/workspace.feedback-profile.e2e.mjs
```

浏览器脚本需要构建产物、Playwright Core 和 Edge（或 BROWSER_EXECUTABLE），使用拦截的 API，截图在 tmp/feedback-profile。Java ReplyFeedbackIntegrationTest 使用 H2 和临时文件，不更新学校 MySQL。

当前结果见 [检查记录](README.md#本次检查与验证)。本次没有修改资料或账号；强制改密前端文案仍未对应后端接口，见 [登录说明](auth-rbac.md)。
