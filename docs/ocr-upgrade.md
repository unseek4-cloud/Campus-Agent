# 文档 OCR 与旧库升级

当前管理员上传保存文件后立即返回，Java 后台工作线程等待 Python 解析完成。Python 先读 PDF 文本层，文本不足的页才渲染和 OCR；云端可失败回 Paddle，全部格式最终复用清洗、切块、Embedding 和 Chroma。

完整环境和启动命令见 [统一启动](service-application-startup.md)，OCR 参数以 [AI README](../ai-service/README.md#ocr-与进度) 及 config.py 为准，本文重点说明旧库和验收边界。

## 已有数据库检查

新库 schema.sql 已包含五个进度字段，V2 没有注册为自动启动 SQL。对早期旧 knowledge_document 表先执行：

```sql
SHOW COLUMNS FROM knowledge_document;
```

核对 parse_status、progress、total_pages、processed_pages、ocr_provider。全部缺失且确认对应旧结构时，在备份后按 [V2__document_ocr_progress.sql](../backend/campus-app/src/main/resources/db/migration/V2__document_ocr_progress.sql) 显式执行；已有字段不可重复 ADD COLUMN，部分已存在需人工按差异处理。

V2 新增字段并把 SUCCESS 映射 COMPLETED/100、FAILED 映射 FAILED，其他状态为 UPLOADED。它是一次性 ALTER，不是可重复的 Flyway 迁移。V3–V12 的当前启动建表机制不能自动修复任意旧结构。

## OCR 流程和限制

```text
PDF → pypdf 按页提取
  → 清洗文字 >=50 字符：使用原文本
  → 不足：PDFium 200 DPI 渲染该页
      → Qwen /responses
      → hybrid 失败回 PaddleOCR
  → 按原页码合并 → 清洗/切块/Embedding/索引
```

默认 AI_OCR_MODE=hybrid、AI_OCR_ALLOW_CLOUD=true、AI_OCR_MAX_CONCURRENCY=4、AI_OCR_MAX_PAGES_PER_DOCUMENT=50、AI_OCR_DEVICE=cpu、AI_OCR_ENABLE_MKLDNN=false。并发信号量限制 PDF 页任务，不保证所有图片解析任务统一限额。页数上限只统计需要 OCR 的 PDF 页。

Qwen OCR 模型默认 qwen3.5-ocr，Key 空时依次复用 AI_QWEN_API_KEY、进程 DASHSCOPE_API_KEY，base URL 空时复用 AI_QWEN_BASE_URL。云请求追加 /responses；聊天追加 /chat/completions。OCR timeout 默认 120 秒、最多 2 次重试。模型/Key/地域/业务空间是否支持该 endpoint 要实际确认，不凭配置名称写成已成功联调。

AI_OCR_MODE=paddle 完全本地，qwen 模式云端失败则失败；allow_cloud=false 强制本地。AI_OCR_ENABLED=false 只关闭 PDF 扫描页回退，图片解析仍调用 OCRManager。文字层已经足够的 PDF 页不会对嵌入截图/复杂表格再做区域识别，DOCX/PPTX 内图片也不执行 OCR。

本地 Paddle 懒加载并复用预测锁，当前配置 PP-OCRv6。任一 PDF 需要识别页失败会使严格模式整体失败，Java 尝试清理向量并保存失败提示。已有旧索引在重建时先删除，失败不会自动恢复。

## 进度与重启

AI 进度仅单进程内存，百分比是阶段权重加页比例，不是速度/剩余时间测量。Java 处理中写入最多 99，成功后 MySQL 100；当前前端约 2 秒轮询，详见 [政策进度](policy-upload-progress.md)。

保持一个 Uvicorn worker。Java 重启把未完成文档标记 FAILED，管理员需重新解析；Python 重启丢失进度，也不自动续任务。原文件在 Java 工作目录的 var/documents，索引在 ai-service/var/chroma，部署须持久化。

## 手工验收

1. 文字 PDF：核对无需 OCR、页数和来源；短文字页可能低于阈值触发 OCR，不能只凭“文字 PDF”保证 scanned=0。
2. 扫描 PDF：核对每页 OCR、页码顺序、Provider 与最终片段；云异常时 hybrid 本地回退。
3. 文字/扫描混合 PDF：仅低文本页处理，查询各页独有内容并核对来源。
4. 多页样本：记录实际 OCR、Embedding 和总耗时；比较模式时使用相同文件和环境，单独记录冷启动。50 个扫描页等于默认上限，不会因相等自动超限；超过 50 才触发。
5. 无效 Key/超时/本地模式：仅在独立验收配置中测试并恢复，记录回退或明确失败；不把 Key、网络、GPU 状态写成仓库事实。
6. 重名相同内容上传：去重不增加文档；失败后重解析重用 ID；两种引擎失败不保留新的残缺索引。清理失败仍应查日志。
7. 学生在 /#/qa 核对真实回答与来源，无证据和 AI 故障分别处理，不能只靠健康接口验收。

这些步骤本次未运行，真实 OCR 质量与耗时待补充。自动测试在 Python tests/unit 的 PDF、OCR、parsers、document_service，以及 tests/integration 的文档 API/Chroma，通常用模拟引擎和临时目录。运行命令见 [AI 测试](../ai-service/README.md#测试与模块位置)，本次结果见 [索引](README.md#本次检查与验证)。
