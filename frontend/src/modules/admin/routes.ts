import type { RouteRecordRaw } from 'vue-router'

export const adminRoutes: RouteRecordRaw[] = [{
  path: '/admin',
  meta: { role: 'ADMIN' },
  component: () => import('./AdminLayout.vue'),
  children: [
    { path: 'ai-quality', name: 'admin-ai-quality', component: () => import('./pages/AIQualityPage.vue') },
    { path: 'applications', name: 'admin-applications', component: () => import('../applications/pages/ApplicationListPage.vue'), props: { admin: true } },
    { path: 'applications/:id', name: 'admin-application', component: () => import('../applications/pages/ApplicationDetailPage.vue'), props: { admin: true } },
    { path: 'services', name: 'admin-services', component: () => import('../serviceguide/pages/ServiceManagementPage.vue') },
    { path: '', name: 'admin-overview', component: () => import('./pages/AdminOverviewPage.vue') },
    { path: 'knowledge', name: 'admin-knowledge', component: () => import('./pages/DocumentManagementPage.vue') },
    { path: 'documents', redirect: '/admin/knowledge' },
  ],
}]
