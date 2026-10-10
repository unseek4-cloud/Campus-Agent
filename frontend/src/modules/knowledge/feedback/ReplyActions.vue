<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { feedbackApi, type Feedback, type Rating } from './api'
import ReplyIcon from './ReplyIcon.vue'
import { errorText } from '../../admin/api'
import { currentUser } from '../../auth/state'
const props = defineProps<{ messageId: number; content: string; feedback?: Feedback | null; disabled?: boolean }>()
const emit = defineEmits<{ feedback: [value: Feedback | null]; share: []; regenerate: []; sources: []; edit: [] }>()
const saving = ref(false), owner = currentUser.value?.id
let alive = true
onBeforeUnmount(() => { alive = false })
const rating = computed(() => props.feedback?.rating)
const label = computed(() => rating.value ? `回复评价：${rating.value === 'POSITIVE' ? '回复优秀' : '回复不佳'}` : '回复评价')
async function rate(value: Rating) {
  if (saving.value) return
  saving.value = true
  try {
    const result = value === rating.value ? (await feedbackApi.cancel(props.messageId), null) : await feedbackApi.rate(props.messageId, value)
    if (alive && owner === currentUser.value?.id) { emit('feedback', result); ElMessage.success(result ? '评价已保存，感谢你的反馈' : '已取消评价') }
  } catch(e) { if (alive) ElMessage.error(errorText(e)) }
  finally { saving.value = false }
}
async function copy() {
  try { await navigator.clipboard.writeText(props.content); ElMessage.success('回复已复制') }
  catch { ElMessage.warning('复制失败，请手动选择文本') }
}
function more(command: string) {
  if (command === 'cancel' && rating.value) void rate(rating.value)
  else if (command === 'sources') emit('sources')
  else if (command === 'edit') emit('edit')
}
</script>
<template>
  <div class="reply-actions" aria-label="AI 回复操作">
    <el-tooltip content="复制回复"><button type="button" aria-label="复制回复" @click="copy"><ReplyIcon name="copy" /></button></el-tooltip>
    <el-dropdown trigger="click" @command="rate">
      <button type="button" :aria-label="label" :title="label" :disabled="saving" :class="{ selected: rating }" aria-haspopup="menu"><ReplyIcon :name="rating === 'POSITIVE' ? 'positive' : rating === 'NEGATIVE' ? 'negative' : 'feedback'" /></button>
      <template #dropdown><el-dropdown-menu class="reply-rating-menu"><el-dropdown-item command="POSITIVE" :disabled="saving" :class="{ 'rating-selected': rating === 'POSITIVE' }"><ReplyIcon name="positive" />回复优秀 <span v-if="rating === 'POSITIVE'">✓</span></el-dropdown-item><el-dropdown-item command="NEGATIVE" :disabled="saving" :class="{ 'rating-selected': rating === 'NEGATIVE' }"><ReplyIcon name="negative" />回复不佳 <span v-if="rating === 'NEGATIVE'">✓</span></el-dropdown-item></el-dropdown-menu></template>
    </el-dropdown>
    <el-tooltip content="分享回复"><button type="button" aria-label="分享回复" @click="emit('share')"><ReplyIcon name="share" /></button></el-tooltip>
    <el-tooltip content="重新生成，保留原回答"><button type="button" aria-label="重新生成" :disabled="disabled" @click="emit('regenerate')"><ReplyIcon name="regenerate" /></button></el-tooltip>
    <el-dropdown trigger="click" @command="more"><button type="button" aria-label="更多操作" title="更多操作" aria-haspopup="menu"><ReplyIcon name="more" /></button><template #dropdown><el-dropdown-menu><el-dropdown-item command="sources">查看知识来源</el-dropdown-item><el-dropdown-item command="edit" :disabled="disabled">编辑原问题</el-dropdown-item><el-dropdown-item v-if="rating" command="cancel" :disabled="saving">取消评价</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
  </div>
</template>
<style scoped>
.reply-actions{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:14px}.reply-actions button{display:grid;place-items:center;width:36px;height:36px;border:0;border-radius:9px;background:transparent;color:var(--el-text-color-secondary);cursor:pointer;transition:background .15s,transform .15s}.reply-actions button:hover,.reply-actions .selected{color:var(--el-color-primary);background:var(--el-color-primary-light-9)}.reply-actions button:active{transform:scale(.93)}.reply-actions button:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:2px}.reply-actions button:disabled{opacity:.4;cursor:wait}@media(max-width:600px){.reply-actions button{width:40px;height:40px}}
</style>
<style>.reply-rating-menu .el-dropdown-menu__item{gap:12px;min-height:44px;font-size:14px}.reply-rating-menu .rating-selected{color:var(--el-color-primary);background:var(--el-color-primary-light-9)}</style>
