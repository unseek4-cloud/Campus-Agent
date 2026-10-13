# 校园事务资料维护工具

本目录的 catalog.py 保存 11 类资料、22 个事项和 5 份材料模板的内容定义。build.py 按定义生成 11 份管理文件、22 份指南、22 份表单、5 份模板和 1 份目录，共 61 份 DOCX；render.py 再生成对应 PDF，全部完成后为 122 个文档文件。

这些内容由项目脚本组织，不是从某一学校正式文件自动抓取的完整政策库。部分定义含教育部参考链接，仍需维护者核对具体学校要求、来源和使用授权。import_library.py 会将事项置为 ACTIVE、isExample=false，并把 catalog.DATE 写入 sourcePublishTime；这些代码值不能证明学校已正式发布或审核通过。

## 工具与依赖

| 文件 | 行为 |
| --- | --- |
| catalog.py | 内容、日期、事项、条件、材料和步骤定义 |
| build.py | 需要 python-docx；生成 DOCX 与资料清单，清理清单中已失效的旧产物 |
| render.py | 由参数指定 renderer 和转换器目录，生成 PDF/页面图并写 hash/页数 |
| import_library.py | httpx 管理员登录/CSRF，导入 PDF、事项、DOCX 模板并保存旧定义/附件备份 |
| verify.py | pypdf/OOXML/hash 检查、学生下载、识别、检索和流程 API 核验 |
| export.py | 根据清单和核验记录复制文件并打包，不删除目标目录的其他资料 |

没有单独 requirements 文件。生成/渲染需文档运行环境和转换工具，renderer/转换器不是仓库内自动装好的依赖；具体可用路径需目标环境确认。AI 虚拟环境含 httpx/pypdf，可用于导入/核验；不要根据它含 AI 依赖就认为它也安装了 python-docx。

## 命令和前置条件

全部命令从仓库根运行。先准备所需 Python 环境，build.py 的入口参数为：

```powershell
python scripts/campus_library/build.py --output var/campus-library
```

render.py 必须提供 --output、--qa、--renderer、--converter-directory，可选 --limit。不要凭空填写机器相关路径。完整渲染后人工检查所有 page-*.png，核对表格/文字，再导入；脚本通过不代表排版或政策内容合格。

已存在且核实完整的产物才执行导入：

```powershell
$env:CAMPUS_LIBRARY_ADMIN_PASSWORD = '填实际应用管理员密码'
& 'ai-service/.venv/Scripts/python.exe' -X utf8 scripts/campus_library/import_library.py --output var/campus-library --username admin --backup tmp/campus-library-backup
Remove-Item Env:CAMPUS_LIBRARY_ADMIN_PASSWORD
```

默认 --url 为 http://127.0.0.1:8080，可覆盖。密码也可由 --credential-file 指定本地文件，格式每行“账号 : 密码”。这里是应用 ADMIN，不是数据库账号。导入会真正修改资料与事项，本次文档更新未执行。

导入先用一次检索初始化模型/Chroma，再最多两个上传任务；SHA-256 相同 PDF 去重，失败记录可重新解析。已有码事项整体更新并增加 version，新编码创建。备份保存首次旧定义及已有模板，不是完整的自动回滚或全库备份。相同模板哈希可复用，下载核对字节。

核验还需凭据文件中的学生账号（默认 20260001）；只有管理员环境变量无法完成学生登录核验：

```powershell
& 'ai-service/.venv/Scripts/python.exe' -X utf8 scripts/campus_library/verify.py --output var/campus-library --credential-file tmp/campus-library-credentials.txt --student 20260001
```

凭据文件是用户自行准备的示例路径，不在仓库生成。verify 会检索资料并发送一次流程问答，公共聊天会留下验收会话；它不只做离线文件检查，也不自动清理会话。检查标签中无“测试/示例/演示”不能证明真实学校授权。

导出参数为 --output 和 --destination：

```powershell
python scripts/campus_library/export.py --output var/campus-library --destination var/campus-library-export
```

需先有完整核验记录。目的目录可替换为实际交付位置，导出保留其他文件，覆盖清单同名产物。

## 记录与待确认

资料清单.json 保存路径/hash/页数，知识库导入记录.json 保存文档/事项/附件关联，事项配置.json 保存结构化定义，资料与访问核验记录.json 保存学生访问和检索检查。var/tmp 是被忽略的运行输出，新克隆不自带成品或核验结论。

本次只检查脚本与说明，未重新生成、渲染、导入或导出。61/122 是内容源计划生成数量，不是当前运行库已入库数量、学校正式资料数量或已验证成果。具体内容、发布时间、政策来源与资料授权需维护者确认。
