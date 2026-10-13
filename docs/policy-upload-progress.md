# 政策处理进度与完成提示

当前管理员 /#/policy-mgr 上传文件后，上传区域和列表显示处理阶段、百分比与页数，列表和详情使用同一个约 2 秒轮询循环。Java 最终状态决定完成，关闭详情后列表继续更新。

## 后端与页面关系

上传 POST /api/admin/documents 保存原文件后返回 PROCESSING，后台 Java 工作线程调用 Python。进度 GET /api/admin/documents/{id}/progress 中含 status、parseStatus、progress、processedPages、totalPages、ocrProvider。短任务可能已直接返回终态，页面按实际响应处理。

阶段为 UPLOADED、PARSING、OCR_PROCESSING、CHUNKING、EMBEDDING、INDEXING、COMPLETED、FAILED。AI 百分比按阶段权重和已处理页比例计算，Java 处理中最高 99、最终 SUCCESS 为 100；不是上传字节比例或实际耗时预测。

前端 [document-progress.js](../frontend/src/workspace/document-progress.js) 保证慢轮询不重叠，同一任务进度不倒退；终态更新片段数、按钮及当前列表计数并提示。网络短暂失败自动继续，404 停止对应文档；重建重新跟踪，离页/退出停止，过期响应不修改新页面。

当前政策页只加载前 100 条文档并在该集合筛选，不具备全库分页 UI。后端虽然支持分页，不能把当前列表计数或搜索覆盖描述成全部库的完整管理结果。

## 验收

按 [统一启动](service-application-startup.md) 准备，管理员上传独立 PDF/TXT，等待无需手工刷新地从处理中到成功；打开/关闭详情检查持续跟踪；重新解析应重新开始；失败显示 Java 保存的友好原因；离页返回恢复已处理中记录。进度任务重启行为见 [OCR 说明](ocr-upgrade.md)。

在 frontend 目录：

```powershell
npm run build
node tests/browser/workspace.policy-progress.e2e.mjs
```

脚本使用拦截的文档 API，截图在 tmp/policy-progress，覆盖主题与手机。真实 OCR/数据库写入需单独验收，本次未执行。当前检查结果在 [文档索引](README.md#本次检查与验证)。
