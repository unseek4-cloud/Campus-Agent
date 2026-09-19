import { createRouter, createWebHistory } from 'vue-router'

import { homeRoutes } from '../../modules/home/routes'
import { knowledgeRoutes } from '../../modules/knowledge/routes'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [...homeRoutes, ...knowledgeRoutes],
  scrollBehavior: () => ({ top: 0 }),
})

export default router
