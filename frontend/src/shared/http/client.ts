import axios from 'axios'

/** Java 业务后端的唯一 HTTP 客户端；前端不得直接访问 AI 服务。 */
export const httpClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 120_000),
  headers: {
    'Content-Type': 'application/json',
  },
})
