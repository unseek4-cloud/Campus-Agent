# 回复反馈与个人菜单：启动和验收

本次更新：学生和管理员均可在“回复不佳”弹窗多选原因，补充说明选填、最多 2000 字。再次选择“回复不佳”可编辑原反馈；“更多操作 → 取消评价”可以撤销。管理员质量分析展示用户原因与说明，管理员自己的分类和处理备注仍单独保存。

侧边栏底部仅显示头像、姓名、身份。点击后展开个人资料、明亮／深色主题、红色的退出登录入口。学生显示姓名、账号、身份、学号、专业、班级和院系；管理员显示姓名、账号、身份和部门。缺失的专业、班级、院系采用四组固定的虚构展示资料，已填写的账户资料优先。登录页始终使用明亮主题，主页面默认明亮，用户手动选择的主题会在本浏览器保留。学生提交登录表单后进入空白新对话，历史仍可从左侧手动打开；刷新当前对话时仍恢复当前内容。

## 启动三个服务

先确保 MySQL 正在运行，保留已配置的 `backend/.env` 和 `ai-service/.env`。在三个独立的 PowerShell 窗口执行以下命令；如果原服务已运行，先在对应窗口按 Ctrl+C 停止，再重新启动。

窗口一，Java 后端：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent
powershell -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1 -Build
```

后端默认地址 `http://127.0.0.1:8080`。`-Build` 会构建新代码，启动时自动执行 V11（可选个人资料）和 V12（反馈详情）的增量建表 SQL。已有用户、会话、反馈不受影响。

窗口二，AI 服务：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent\ai-service
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

项目当前已有 `.venv`。若在另一台电脑首次启动，先执行 `python -m venv .venv`，再执行 `.\.venv\Scripts\python.exe -m pip install -r requirements.txt`。保留现有 `.env` 中的 AI 模型配置。

窗口三，Vue 前端：

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent\frontend
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

首次安装依赖时先执行 `npm ci`。打开 `http://127.0.0.1:5173/`，按 Ctrl+F5 刷新即可验收。三个窗口保持运行。

可以在另一个 PowerShell 窗口检查服务状态：

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/v1/health
Invoke-RestMethod http://127.0.0.1:8000/internal/v1/health
```

## 手工验收

1. 分别使用学生和管理员账号登录。首次使用浏览器时，登录页和主页面均为明亮主题。学生即使有上次会话记录，提交登录表单后也应进入空白新对话。
2. 发送问题，或打开历史会话。点击 AI 回复的评价按钮，再点“回复不佳”，应出现七种原因、多选按钮和选填说明框。
3. 只选原因、留空说明，点击提交。重新打开反馈，应恢复原因；填写说明并再次提交，刷新页面后应恢复原因与说明。
4. 打开反馈后按 Esc、点关闭按钮或点遮罩，应关闭弹窗且不提交修改。“更多操作 → 取消评价”可取消已保存评价。
5. 侧边栏底部只有紧凑的个人入口；点击后才出现详细信息、主题和红色的退出登录字样。未填写专业、班级、院系的学生应能看到虚构展示资料。切换主题立即生效，刷新保留选择。退出登录后登录页恢复明亮主题。
6. 管理员在“AI 问答质量分析”中查看用户选的原因与说明，并能继续单独填写处理分类和备注。
7. 使用手机尺寸检查反馈弹窗和个人菜单，没有横向溢出，按钮和说明框能操作。

## 个人资料来源

姓名、账号、角色、学号沿用 `user_account`。可选院系／部门、专业、班级存放于 `user_profile`；空字段在页面采用虚构示例兜底，例如“计算机与信息学院／软件工程／软件工程2601班”。这些示例仅用于展示，不写入数据库。需要填入真实资料时，可由数据库维护人员在 MySQL 执行以下示例，并替换成实际账号与资料：

```sql
INSERT INTO user_profile (user_id, department, major, class_name)
SELECT id, '实际院系', '实际专业', '实际班级'
FROM user_account WHERE username = '实际学生账号'
ON DUPLICATE KEY UPDATE department = '实际院系', major = '实际专业', class_name = '实际班级';
```

重新登录后即可查看。管理员可仅填写 `department`，专业和班级不展示。

## 自动检查

```powershell
cd D:\AIC_ai-agent\Project\Campus-Agent\frontend
npm test
npm run test:browser
cd ..\backend
mvn package
```

浏览器测试使用 Edge 和拦截的测试 API；Java 集成测试使用 H2 内存数据库，不修改实际账号或学校资料。浏览器验收截图输出到 `tmp/feedback-profile/`。
