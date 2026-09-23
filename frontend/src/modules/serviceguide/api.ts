import { httpClient } from '../../shared/http/client'
import type { ApiResponse } from '../knowledge/types'
import type { MaterialAttachment, ServiceDetail, ServiceItem } from './types'

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

type MaterialUploadConfig = { maxUploadSizeMb: number; extensions: string[] }
let uploadConfig: Promise<MaterialUploadConfig> | undefined
export function getMaterialUploadConfig(): Promise<MaterialUploadConfig> {
  return uploadConfig ??= httpClient.get('/admin/material-attachments/config').then(response => response.data.data)
    .catch(error => { uploadConfig = undefined; throw error })
}
export async function uploadMaterialAttachment(serviceId: number, materialId: string, file: File): Promise<MaterialAttachment> {
  const body = new FormData(); body.append('file', file)
  return (await httpClient.post(`/admin/services/${serviceId}/materials/${encodeURIComponent(materialId)}/attachment`, body,
    { headers: { 'Content-Type': 'multipart/form-data' } })).data.data
}
export async function deleteMaterialAttachment(serviceId: number, materialId: string): Promise<void> {
  await httpClient.delete(`/admin/services/${serviceId}/materials/${encodeURIComponent(materialId)}/attachment`)
}
function downloadPath(attachment: MaterialAttachment, admin = false): string {
  if (!/^\/api\/files\/[a-f0-9-]{36}\/download$/i.test(attachment.downloadUrl)) throw new Error('附件下载地址无效')
  return attachment.downloadUrl.replace('/api/', admin ? '/admin/' : '/')
}
export function materialDownloadUrl(attachment: MaterialAttachment, admin = false): string {
  return `${String(httpClient.defaults.baseURL ?? '/api').replace(/\/$/, '')}${downloadPath(attachment, admin)}`
}
export async function downloadMaterialAttachment(attachment: MaterialAttachment, admin = false): Promise<void> {
  const response = await httpClient.get<Blob>(downloadPath(attachment, admin), { responseType: 'blob' })
  const disposition = String(response.headers['content-disposition'] || '')
  const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]
  const filename = encodedName ? decodeURIComponent(encodedName) : attachment.filename
  const url = URL.createObjectURL(response.data), link = document.createElement('a')
  try {
    link.href = url; link.download = filename; link.hidden = true
    document.body.append(link); link.click()
  } finally {
    link.remove()
    // Give the browser time to acquire the blob before releasing its object URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}
