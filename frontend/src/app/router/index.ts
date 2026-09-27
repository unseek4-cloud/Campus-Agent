import { createRouter, createWebHistory } from 'vue-router'

import { homeRoutes } from '../../modules/home/routes'
import { knowledgeRoutes } from '../../modules/knowledge/routes'
import { adminRoutes } from '../../modules/admin/routes'
import { clearIdentity, currentUser, homeForRole, restoreIdentity } from '../../modules/auth/state'
import { ElMessage } from 'element-plus'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/login', name: 'login', component: () => import('../../modules/auth/LoginPage.vue') },
    { path: '/forbidden', name: 'forbidden', component: () => import('../../modules/auth/ForbiddenPage.vue') },
    { path: '/student', redirect: '/' },
    ...homeRoutes, ...knowledgeRoutes, ...adminRoutes,
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(async to => {
  try { await restoreIdentity(to.path !== '/login') }
  catch { ElMessage.error('暂时无法连接服务器，请稍后重试'); return to.path === '/login' ? true : '/login' }
  if (!currentUser.value) return to.path === '/login' ? true : '/login'
  if (to.path === '/login') return homeForRole()
  if (to.matched.some(record => record.meta.role === 'ADMIN') && currentUser.value.role !== 'ADMIN') return '/forbidden'
  return true
})

window.addEventListener('campus:unauthorized', () => {
  clearIdentity()
  void router.replace('/login')
})
// BFCache may restore an old page without running a navigation guard.
window.addEventListener('pageshow', event => {
  if (event.persisted) void restoreIdentity(true).then(() => {
    if (!currentUser.value) void router.replace('/login')
  }).catch(() => { clearIdentity(); void router.replace('/login') })
})

export default router
