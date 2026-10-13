# 高校校园事务资料维护

本目录保存 11 类制度、22 个事项及其配套表单的内容源，并通过现有管理员 API 完成知识库索引、事项来源关联和材料附件上传。公开资料不包含学生个人申请记录。

资料包括 11 份管理文件、22 份办理指南、22 份申请或登记表、5 份材料模板和 1 份总目录。每份同时提供 DOCX 与 PDF，共 122 个文档文件。金额、名额、具体日期、电话和窗口位置应根据学校实际通知维护。

`catalog.py` 为内容和流程源，`build.py` 生成可编辑文档，`render.py` 调用 documents 技能中的渲染器转换 PDF 与页面图片，`import_library.py` 通过管理员登录、CSRF 和现有接口导入，`verify.py` 核对学生身份下的来源、附件和检索，`export.py` 将核验后的文件复制到指定目录并打包。

生成时使用 Codex 随附的 Python 文档运行环境；导入和访问核验使用 AI 服务的虚拟环境。渲染完成后必须检查所有页面图片，确认版式及表格完整再导入。

从仓库根目录导入现有成品：

```powershell
$env:CAMPUS_LIBRARY_ADMIN_PASSWORD = '本地管理员密码'
& 'ai-service/.venv/Scripts/python.exe' -X utf8 scripts/campus_library/import_library.py --output var/campus-library --username admin --backup tmp/campus-library-backup
```

也可使用未提交的本地凭据文件，通过 `--credential-file` 指定。密码不写入内容源、清单和导入记录。默认接口为 `http://127.0.0.1:8080`，可用 `--url` 指定实际后台。

导入前先以单次检索完成模型和向量库初始化，再以最多两个并发任务上传，避免首次初始化和队列容量问题。相同 PDF 按现有 SHA-256 去重；已存在的事项按业务编码更新，新事项按编码创建，原事项 ID 保留。事项更新前保存旧定义及已有附件，附件上传后核对下载内容哈希。

管理员界面中的新增资料均完成解析后，`知识库导入记录.json` 保存文档 ID、片段数及事项关联；`事项配置.json` 保存完整结构化定义；`资料与访问核验记录.json` 保存学生权限下的访问结果。导出只复制清单内文件，不删除目标目录其他资料。
