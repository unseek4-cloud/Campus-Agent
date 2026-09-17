import { createRouter, createWebHistory } from 'vue-router'

import { homeRoutes } from '../../modules/home/routes'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [...homeRoutes],
  scrollBehavior: () => ({ top: 0 }),
})

export default router

