<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
const props = defineProps({ workspace: { type: Object, required: true }, state: { type: Object, required: true } })
const open = ref(false), trigger = ref(null), panel = ref(null), position = ref({})
const role = computed(() => props.state.user?.role === 'admin' ? '系统管理员' : '学生')
const details = computed(() => {
  const user = props.state.user || {}
  return [['姓名', user.name], ['账号', user.username], ['身份', role.value],
    ...(user.role === 'student' ? [['学号', user.studentNo], ['专业', user.major], ['班级', user.className]] : []),
    ['院系／部门', user.dept]]
})
function close(focus = false) {
  open.value = false
  if (focus === true) trigger.value?.focus()
}
async function toggle() {
  if (open.value) return close()
  open.value = true
  await nextTick()
  const rect = trigger.value.getBoundingClientRect()
  const width = panel.value.offsetWidth, height = panel.value.offsetHeight
  position.value = { left: `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`,
    top: `${Math.max(12, rect.top - height - 8)}px` }
  panel.value.querySelector('button')?.focus()
}
function outside(event) {
  if (!panel.value?.contains(event.target) && !trigger.value?.contains(event.target)) close()
}
function key(event) {
  if (!open.value) return
  if (event.key === 'Escape') { event.preventDefault(); close(true); return }
  if (event.key !== 'Tab') return
  const buttons = [...panel.value.querySelectorAll('button')]
  if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus() }
  else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus() }
}
watch(() => [props.state.auth, props.state.route, props.state.user?.id], () => close())
onMounted(() => {
  document.addEventListener('pointerdown', outside)
  document.addEventListener('keydown', key)
  window.addEventListener('resize', close)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside)
  document.removeEventListener('keydown', key)
  window.removeEventListener('resize', close)
})
</script>

<template>
  <button ref="trigger" id="userMenuToggle" class="user-card user-menu-trigger" type="button"
    aria-label="个人信息与设置" aria-haspopup="dialog" :aria-expanded="open" aria-controls="userMenu" @click="toggle">
    <span class="avatar">{{ state.user?.name?.slice(0, 1) || '学' }}</span>
    <span class="user-meta"><span class="user-name">{{ state.user?.name }}</span><span class="user-role">{{ role }}</span></span>
    <svg class="user-menu-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path :d="open ? 'm7 14 5-5 5 5' : 'm7 10 5 5 5-5'"/></svg>
  </button>
  <Teleport to="body">
    <section v-if="open" ref="panel" id="userMenu" class="user-menu" :style="position" role="dialog" aria-modal="true" aria-labelledby="userMenuTitle">
      <div class="user-menu-heading"><h2 id="userMenuTitle">个人信息</h2><button class="icon-btn" type="button" aria-label="关闭个人菜单" @click="close(true)">✕</button></div>
      <dl class="user-menu-details"><div v-for="[label, value] in details" :key="label"><dt>{{ label }}</dt><dd>{{ value || '未填写' }}</dd></div></dl>
      <div class="user-menu-theme"><span>外观主题</span><div role="group" aria-label="外观主题">
        <button id="themeLight" type="button" :aria-pressed="state.theme !== 'dark'" @click="workspace.actions.setTheme('light')">明亮</button>
        <button id="themeDark" type="button" :aria-pressed="state.theme === 'dark'" @click="workspace.actions.setTheme('dark')">深色</button>
      </div></div>
      <button id="logoutBtn" class="user-menu-logout" type="button" @click="close(); workspace.actions.logout()">退出登录</button>
    </section>
  </Teleport>
</template>
