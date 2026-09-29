<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Conversation } from './api'
const props = defineProps<{ conversations: Conversation[]; activeId: number | null; busy: boolean; newDisabled: boolean; remove: (id: number) => Promise<void> }>()
const emit = defineEmits<{ select: [id: number]; create: [] }>()
const expanded = ref(false)
function time(value: string) {
  const date = new Date(value), today = new Date()
  return date.toDateString() === today.toDateString()
    ? `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
async function confirmDelete(conversation: Conversation) {
  try {
    await ElMessageBox.confirm('确定删除此对话吗？删除后无法恢复。', '删除对话', {
      confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning',
    })
  } catch { return }
  try { await props.remove(conversation.id) } catch { ElMessage.error('删除失败，请稍后重试') }
}
</script>
<template>
  <aside class="chat-history" aria-label="历史对话">
    <div class="history-heading"><h2>历史对话</h2><el-button class="history-toggle" text @click="expanded = !expanded">{{ expanded ? '收起' : '展开' }}</el-button></div>
    <el-button class="new-conversation" :disabled="newDisabled" @click="emit('create')">＋ 新建对话</el-button>
    <div class="history-list" :class="{ expanded }">
      <p v-if="!conversations.length" class="history-empty">你的对话会自动保存在这里</p>
      <div v-for="conversation in conversations" :key="conversation.id" class="history-item" :class="{ selected: conversation.id === activeId }">
        <button class="history-select" :disabled="busy" :aria-current="conversation.id === activeId ? 'true' : undefined" @click="emit('select', conversation.id)">
          <span :title="conversation.title">{{ conversation.title }}</span><small>{{ time(conversation.updatedAt) }}</small>
        </button>
        <el-button class="history-delete" text :disabled="busy" :aria-label="`删除对话：${conversation.title}`" @click="confirmDelete(conversation)">删除</el-button>
      </div>
    </div>
  </aside>
</template>
<style scoped>
.chat-history{background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:18px;position:sticky;top:24px;align-self:start;min-width:0}
.history-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}.history-heading h2{font-size:16px;margin:0;color:#334155}.new-conversation{width:100%;margin-bottom:16px}.history-list{max-height:65vh;overflow:auto}.history-item{display:flex;align-items:center;border:1px solid transparent;border-radius:10px;margin-bottom:6px}.history-item.selected{background:#eaf2ff;border-color:#d4e3f7}.history-select{border:0;background:transparent;text-align:left;padding:12px 8px;flex:1;min-width:0;cursor:pointer;color:#334155;font:inherit}.history-select span{display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:14px}.history-select small{display:block;color:#8492a6;font-size:12px;margin-top:7px}.history-delete{font-size:12px;padding:6px}.history-empty{font-size:13px;color:#8492a6;line-height:1.8}.history-toggle{display:none}
@media(max-width:800px){.chat-history{position:static}.history-toggle{display:inline-flex}.history-list{display:none;max-height:280px}.history-list.expanded{display:block}.new-conversation{margin-bottom:0}.history-list.expanded{margin-top:12px}}
</style>
