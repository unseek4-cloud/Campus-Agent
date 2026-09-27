import { ref } from 'vue'
import axios from 'axios'
import { httpClient, resetCsrf } from '../../shared/http/client'
import type { CurrentUser } from './types'

export const currentUser = ref<CurrentUser | null>(null)
let pending: Promise<void> | undefined
let initialized = false

export function clearIdentity() {
  currentUser.value = null
  initialized = false
  resetCsrf()
}

export function restoreIdentity(force = false): Promise<void> {
  if (pending) return pending
  if (initialized && !force) return Promise.resolve()
  pending = httpClient.get('/auth/me').then(response => {
    currentUser.value = response.data.data
    initialized = true
  }).catch(error => {
    clearIdentity()
    if (!axios.isAxiosError(error) || error.response?.status !== 401) throw error
    initialized = true
  }).finally(() => { pending = undefined })
  return pending
}

export async function login(username: string, password: string) {
  const response = await httpClient.post('/auth/login', { username, password })
  resetCsrf()
  currentUser.value = response.data.data.user
  initialized = true
}

export async function logout() {
  await httpClient.post('/auth/logout')
  clearIdentity()
}

export function homeForRole() { return currentUser.value?.role === 'ADMIN' ? '/admin' : '/' }
