import type { RouteRecordRaw } from 'vue-router'
export const applicationRoutes: RouteRecordRaw[] = [{
  path: '/student', component: () => import('./StudentApplicationLayout.vue'), meta: { role: 'STUDENT' },
  children: [
    { path: 'services/:id/apply', name: 'application-create', component: () => import('./pages/ApplicationCreatePage.vue') },
    { path: 'applications', name: 'student-applications', component: () => import('./pages/ApplicationListPage.vue') },
    { path: 'applications/:id', name: 'student-application', component: () => import('./pages/ApplicationDetailPage.vue') },
  ],
}]
