import type { RouteRecordRaw } from 'vue-router'

export const knowledgeRoutes: RouteRecordRaw[] = [
  {
    path: '/knowledge/search',
    name: 'knowledge-search',
    component: () => import('./pages/KnowledgeSearchPage.vue'),
    meta: {
      title: '知识库检索测试',
    },
  },
]
