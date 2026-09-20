import type { RouteRecordRaw } from 'vue-router'

export const adminRoutes: RouteRecordRaw[] = [{
  path: '/admin',
  component: () => import('./AdminLayout.vue'),
  children: [
    { path: '', name: 'admin-overview', component: () => import('./pages/AdminOverviewPage.vue') },
    { path: 'knowledge', name: 'admin-knowledge', component: () => import('./pages/DocumentManagementPage.vue') },
    { path: 'documents', redirect: '/admin/knowledge' },
  ],
}]
