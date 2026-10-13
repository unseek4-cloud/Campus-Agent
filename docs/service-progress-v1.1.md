# 办事准备进度与材料勾选

当前问答卡片支持当前步骤、已完成/待完成状态、推进、回退、最后一步完成、重新开始和材料勾选。它是个人准备清单，正式申请状态来自数据库审核，两者相互独立。学生与管理员在问答中都可保存个人清单；事项预览和公开分享为只读。

## 当前实现与存储

算法位于 [serviceProgress.ts](../frontend/src/modules/serviceguide/services/serviceProgress.ts)，Vue 直接导入，不再生成一份静态 JavaScript。用户连接和卡片交互位于 [service-guide.js](../frontend/src/workspace/service-guide.js)。

领域 store 默认键为 campusagent:service-progress:{serviceCode}，当前页面通过存储适配器加上账号前缀，完整键为：

```text
campusagent:user:<userId>:campusagent:service-progress:<serviceCode>
```

切换账号/退出时重新装配 store，避免两个账号共用内存状态。普通浏览器 localStorage 按 origin 隔离，localhost、127.0.0.1、不同端口均不共享；不包含学校/知识库标识，也不跨设备或向服务器同步。

缓存保存 serviceCode、serviceId、serviceVersion、currentStep、completedSteps、checkedMaterials、completed、updatedAt。checkedMaterials 当前按材料名称保存，不是附件 ID；同一事项中的同名材料无法据此严格区分。

```json
{
  "serviceCode": "PSYCHOLOGICAL_ASSESSMENT",
  "serviceId": 3,
  "serviceVersion": 0,
  "currentStep": 2,
  "completedSteps": [1],
  "checkedMaterials": [],
  "completed": false,
  "updatedAt": "2026-10-13T02:00:00.000Z"
}
```

示例数字不代表当前库已有该事项。数据流为：后端结构化流程 → store 校验 → 用户操作 → 内存/localStorage → 同页面订阅卡片更新。推进和勾选不调用后端或 LLM。

## 算法与兼容

1. 正整数 order 排序、去重。无步骤时 currentStep=null、completed=false，没有推进操作。
2. 初始选首个合法步骤。完成校验按钮期望 order，与当前步骤一致才推进；取下一数组项，不使用 order+1。
3. 最后一步设置 completed=true、保留最后合法 order，完成比例按已完成数/步骤数计算。
4. 回退撤销该步及其后的确认；完成页可返回最后一步。重新开始需确认，仅清除当前事项步骤与材料。
5. 同版本缓存只保留合法且连续的已完成前缀，新增未完成步骤不会被跳过；完全完成后追加步骤会重新打开新步骤。
6. serviceVersion 或 serviceId 变化保守重置。管理员保存会重建步骤并增加 version，即使只是文字修改也可能重置清单。
7. 已读取新版本后旧卡片不能覆盖新定义。重复卡片通过共享 store 更新。
8. store 按事项有 500ms 操作锁，卡片约 520ms 后恢复操作，防止双击跳步。材料勾选不会自动完成步骤。
9. 存储读取/解析/写入异常受保护，被禁用时仍可在内存操作并提示不可持久化。
10. 后端 currentStep=1 或 AI 正文不能作为用户完成依据，算法不使用不稳定 stepId。

流程更新在收到新响应时检测，不主动轮询管理员变更。旧历史卡片保存的是当时流程快照，不能保证一直等于最新目录。

## 启动、测试与手工核查

启动见 [统一说明](service-application-startup.md)。页面为 /#/qa，事项管理为 /#/services-mgr。聊天正文现已保存到 MySQL，刷新可恢复，不再是早期 V1.1 的“刷新清空聊天”。

在 frontend 目录：

```powershell
npm test
npm run build
node tests/browser/workspace.chat-workspace.e2e.mjs
```

最后一条需要先 build，读取实际构建页并模拟 API；浏览器依赖见 [前端说明](../frontend/README.md)。单元测试覆盖损坏缓存、非连续顺序、空/单步骤、版本变化、同事项订阅、双击和不可用存储。当前总数统一记录在 [检查结果](README.md#本次检查与验证)。

人工检查：明确询问一个已启用流程；完成一步、快速重复点击、回退、勾选材料、全部完成和重置；刷新并打开历史，检查保留；退出换账号确认初始状态；原账号再登录打开历史确认其独立清单。公开分享页不能推进、勾选、申请或下载模板。

## 限制

只保证同一页面重复卡片同步，没有多标签实时合并。清站点数据后不能恢复；流程版本变化会重置；历史卡片可能保留旧版本；材料勾选按名称；存储不可用时刷新丢失。没有服务端 student_service_progress 表，不能将“我的申请”误当成已经实现的跨设备准备清单。
