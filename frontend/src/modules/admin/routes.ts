import type { RouteRecordRaw } from 'vue-router'

export const adminRoutes: RouteRecordRaw[] = [{
  path: '/admin',
  meta: { role: 'ADMIN' },
  component: () => import('./AdminLayout.vue'),
  children: [
    { path: 'services', name: 'admin-services', component: () => import('../serviceguide/pages/ServiceManagementPage.vue') },
    { path: '', name: 'admin-overview', component: () => import('./pages/AdminOverviewPage.vue') },
    { path: 'knowledge', name: 'admin-knowledge', component: () => import('./pages/DocumentManagementPage.vue') },
    { path: 'documents', redirect: '/admin/knowledge' },
  ],
}]
