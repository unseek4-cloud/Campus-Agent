import { createRouter, createWebHashHistory } from 'vue-router'
import WorkspacePage from './components/WorkspacePage.vue'

const pages = ['qa', 'dashboard', 'search', 'affairs', 'my-applications',
  'policy-mgr', 'services-mgr', 'review', 'audit', 'ai-quality', 'settings']

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: { render: () => null } },
    ...pages.map(name => ({ path: `/${name}`, name, component: WorkspacePage, props: { name } })),
    { path: '/share/:token', name: 'share', component: { render: () => null } },
    { path: '/:pathMatch(.*)*', redirect: '/qa' },
  ],
})
