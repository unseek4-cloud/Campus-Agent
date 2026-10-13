<script setup>
defineProps({ workspace: { type: Object, required: true } })
</script>

<template>
<div class="qa-layout is-empty"><div class="qa-chat">
      <div class="qa-chat-head" id="qaActions" hidden><span class="session-state" id="sessionState">智能问答</span>
        <div class="qa-head-actions"><button class="btn btn-sm btn-ghost" @click="workspace.actions.openShareDialog()">分享对话</button><button class="btn btn-sm btn-ghost" @click="workspace.actions.newConversation()">新对话</button></div>
      </div>
      <div class="qa-empty" id="qaEmpty"><h1>校园事务，从这里开始</h1><p>问政策、找材料、理清办理步骤。</p></div>
      <div class="qa-chat-body" id="chatBody" aria-label="问答消息" aria-live="polite"></div>
      <div class="qa-input-area"><div class="qa-input-wrap">
        <textarea class="qa-input" id="qaInput" rows="1" aria-label="输入你的问题" maxlength="2000" placeholder="有什么校园事务想了解？"></textarea>
        <button class="qa-send" id="qaSend" type="button" title="发送问题" aria-label="发送问题" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></button>
      </div><div class="qa-input-foot"><span>回答附来源 · 办理以学校最新通知为准</span><span id="chatStatus" role="status"></span></div></div>
      <div class="qa-starters"><button class="qa-suggestion" data-question="国家奖学金的申请条件是什么？">奖学金申请条件</button><button class="qa-suggestion" data-question="学生证丢了怎么补办？">学生证补办流程</button><button class="qa-suggestion" data-question="宿舍怎么报修？">宿舍报修</button></div>
    </div></div>
</template>
