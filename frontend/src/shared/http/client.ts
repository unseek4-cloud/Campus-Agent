import axios from 'axios'
import { ElMessage } from 'element-plus'

/** Java 业务后端的唯一 HTTP 客户端；前端不得直接访问 AI 服务。 */
export const httpClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 120_000),
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

let csrf: { token: string; headerName: string } | undefined
let csrfRequest: Promise<void> | undefined
export function resetCsrf() { csrf = undefined }

httpClient.interceptors.request.use(async config => {
  if (!['get', 'head', 'options'].includes((config.method ?? 'get').toLowerCase())) {
    if (!csrf) {
      csrfRequest ??= httpClient.get('/auth/csrf').then(response => { csrf = response.data.data })
        .finally(() => { csrfRequest = undefined })
      await csrfRequest
    }
    if (csrf) config.headers.set(csrf.headerName, csrf.token)
  }
  return config
})

httpClient.interceptors.response.use(response => response, error => {
  const status = error.response?.status
  const url = error.config?.url ?? ''
  if (status === 401 && !['/auth/login', '/auth/me'].includes(url)) {
    window.dispatchEvent(new Event('campus:unauthorized'))
  }
  if (status === 403 && url !== '/auth/login') {
    if (error.response?.data?.code === 'CSRF_INVALID') {
      resetCsrf()
      ElMessage.error('页面验证已过期，请重试')
    } else ElMessage.error('你没有权限访问该页面。')
  }
  return Promise.reject(error)
})
