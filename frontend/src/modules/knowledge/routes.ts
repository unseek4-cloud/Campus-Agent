import type { RouteRecordRaw } from 'vue-router'

export const knowledgeRoutes: RouteRecordRaw[] = [
  {
    path: '/knowledge/search',
    name: 'knowledge-search',
    component: () => import('./pages/KnowledgeSearchPage.vue'),
    meta: {
      title: '校园事务智能问答',
    },
  },
]
