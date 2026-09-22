import { httpClient } from '../../shared/http/client'
import type { ApiResponse } from '../knowledge/types'
import type { ServiceDetail, ServiceItem } from './types'

export async function listServices(): Promise<ServiceItem[]> {
  return (await httpClient.get<ApiResponse<ServiceItem[]>>('/admin/services')).data.data
}
export async function getService(id: number): Promise<ServiceDetail> {
  return (await httpClient.get<ApiResponse<ServiceDetail>>(`/admin/services/${id}`)).data.data
}
export async function saveService(data: ServiceDetail): Promise<ServiceDetail> {
  const response = data.service.id === null
    ? await httpClient.post<ApiResponse<ServiceDetail>>('/admin/services', data)
    : await httpClient.put<ApiResponse<ServiceDetail>>(`/admin/services/${data.service.id}`, data)
  return response.data.data
}
export async function deleteService(item: ServiceItem): Promise<void> {
  await httpClient.delete(`/admin/services/${item.id}`, { params: { version: item.version } })
}
export function sourceFileUrl(id: number): string {
  return `${String(httpClient.defaults.baseURL ?? '/api').replace(/\/$/, '')}/services/${id}/source`
}
export function safeSourceUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href
  } catch { /* Missing or invalid links are rendered as plain text. */ }
  return undefined
}
