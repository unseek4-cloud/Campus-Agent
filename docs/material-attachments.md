# 材料模板附件

任意事项的每项材料可关联零个或一个模板。模板用于下载填写，不传入 AI、不生成向量，也不是学生提交的私有申请附件。当前管理员在 /#/services-mgr 编辑事项，学生在办事卡片或事项详情下载。

## 数据与一致性

service_item.materials 仍是 JSON，没有独立材料业务表。读取旧材料时按事项 ID 和数组位置生成确定性 UUID，首次上传/保存后写回 JSON；此后重排、改名仍使用同一材料 ID。没有 ID 的旧保存请求按唯一材料名匹配，跨事项 ID 会被拒绝。attachment 不信任前端保存值，只从附件表生成。

V4 创建 service_material_attachment：id（文件 UUID）、service_item_id、material_id、original_filename、content_type、file_size、created_at/updated_at。`(service_item_id,material_id)` 唯一；事项外键删除级联。V4 随 SQL Init 启动建表，不插入示例，也不批量改旧材料 JSON。完整升级顺序见 [后端数据库](../backend/README.md#数据库设计与升级)。

文件默认在 Java 工作目录的 var/documents/materials，仓库脚本启动时即 backend/var/documents/materials。MATERIAL_UPLOAD_DIR 可覆盖，磁盘仅使用 UUID 原文件名，显示名不作为路径。LocalFileStorage 使用 CREATE_NEW 防覆盖。

事项定义和附件写入共用父事项行锁。替换先写新文件、提交新关联，回滚删除新文件，提交后清旧文件；删除模板保留材料，删除材料/事项清对应模板。附件操作不增加流程 version。

磁盘清理失败会记录 Attachment file cleanup pending；被移除的关联不可再下载，但可能留下孤立文件。强制中断也可能遗留文件，目前无自动清理任务，不能宣称跨数据库与磁盘原子一致。

## 白名单与校验

支持 DOC、DOCX、PDF、XLS、XLSX、ZIP，默认 20 MB，复用 ADMIN_MAX_UPLOAD_SIZE_MB（模板服务校验 1–100）。multipart 请求上限 101 MB。

服务端核对扩展名、非空、大小和内容签名；此模板验证器不依据客户端 MIME 判断格式，服务端用扩展名白名单确定返回 MIME。DOC/XLS 只检查 OLE 文件头，不做语义解析或病毒扫描。DOCX/XLSX 校验包清单和主文档；ZIP 最多 4096 项、解压字节总量最多 100 MB，只扫描、不解压到磁盘。名称剥离目录并拒绝控制字符。

知识库白名单与这里不同，不能因支持 XLS 模板就写成知识检索支持旧 Excel。

## API 与下载

| 方法 | 路径 | 权限与请求 |
| --- | --- | --- |
| GET | /api/admin/material-attachments/config | ADMIN；extensions、maxUploadSizeMb |
| POST | /api/admin/services/{serviceId}/materials/{materialId}/attachment | ADMIN；multipart file，上传/替换 |
| DELETE | 同上 | ADMIN；删模板保留材料 |
| GET | /api/files/{id}/download | 已登录；仅 ACTIVE 事项仍关联的模板 |
| GET | /api/admin/files/{id}/download | ADMIN；可读取草稿/停用事项模板 |

JSON 使用 ApiResponse。id 必须是事项响应给出的稳定材料 ID，不是名称或下标：

```json
{
  "id": "材料UUID",
  "name": "补办申请表",
  "description": "按要求填写",
  "required": true,
  "attachment": {
    "id": "文件UUID",
    "filename": "补办申请表.docx",
    "downloadUrl": "/api/files/文件UUID/download"
  }
}
```

无模板时 attachment=null。下载核查文件、事项状态及材料关联，返回 Content-Type、长度、UTF-8 Content-Disposition attachment、nosniff、no-store。当前前端使用真实下载链接/浏览器文件下载，没有 Axios Blob 客户端。登录和 CSRF 见 [认证说明](auth-rbac.md)，公开分享页隐藏模板下载。

## 使用与验收

新事项/材料先整体保存，再上传模板。附件操作立即生效，取消事项编辑不会撤销已完成的模板上传。

按 [统一启动](service-application-startup.md) 准备 Java 和 Vue；模板功能本身不依赖 Python。管理员上传含中文/空格的有效模板，学生核对下载名称与内容、勾选不受下载影响；替换后旧文件链接 404；删除后材料仍在、链接消失。草稿/停用事项学生模板链接 404，管理员路径仍可用。

还应核对同名不同事项、空文件、超过限制、伪装扩展名、匿名、学生上传和缺 CSRF。这些是验收步骤，本次没有改真实事项或模板。

自动测试为 MaterialAttachmentIntegrationTest、ServiceGuideTest，使用 H2 和临时目录。前端 browser 回归入口是 npm run test:browser，旧 materialAttachments.e2e.mjs 已不存在。scripts/create-material-test-fixtures.py 仅用标准库生成最小 DOCX，不上传也不自动驱动 Word/WPS。当前测试结果统一见 [文档索引](README.md#本次检查与验证)。
