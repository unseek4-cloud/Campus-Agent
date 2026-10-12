import axios from 'axios'
import { httpClient } from '../../shared/http/client'
import type { ServiceDetail } from '../serviceguide/types'
import type { ApplicationRecord, ApplicationDetail, ApplicationPage, ApplicationStatus, ApplicationAttachment, UploadConfig, SelectedAttachment } from './types'

export const applicationPath = (admin = false) => admin ? '/admin/applications' : '/student/applications'
export async function listApplications(admin: boolean, status: string, page: number): Promise<ApplicationPage> {
  return (await httpClient.get(applicationPath(admin), { params: { status, page, pageSize: 10 } })).data.data
}
export async function getApplication(id: number, admin = false): Promise<ApplicationDetail> {
  return (await httpClient.get(`${applicationPath(admin)}/${id}`)).data.data
}
export async function getActiveApplication(serviceItemId: number): Promise<ApplicationRecord | null> {
  return (await httpClient.get(`${applicationPath()}/active`, { params: { serviceItemId } })).data.data
}
export async function getApplicationService(id: number): Promise<ServiceDetail> {
  return (await httpClient.get(`/services/${id}`)).data.data
}
export async function uploadConfig(): Promise<UploadConfig> { return (await httpClient.get(`${applicationPath()}/upload-config`)).data.data }
export async function submitApplication(serviceItemId: number, studentRemark: string, files: SelectedAttachment[], existing?: ApplicationRecord): Promise<ApplicationDetail> {
  const data = new FormData()
  data.append('serviceItemId', String(serviceItemId)); data.append('studentRemark', studentRemark)
  if (existing) data.append('version', String(existing.version))
  files.forEach(item => { data.append('files', item.file); data.append('materialIds', item.materialId) })
  return (await httpClient.post(existing ? `${applicationPath()}/${existing.id}/resubmit` : applicationPath(), data,
    { headers: { 'Content-Type': 'multipart/form-data' } })).data.data
}
export async function reviewApplication(item: ApplicationRecord, status: ApplicationStatus, remark: string): Promise<ApplicationDetail> {
  return (await httpClient.patch(`${applicationPath(true)}/${item.id}/review`, { status, remark, version: item.version })).data.data
}
export async function downloadApplicationAttachment(file: ApplicationAttachment, admin: boolean) {
  const response = await httpClient.get(`${applicationPath(admin)}/attachments/${encodeURIComponent(file.id)}/download`, { responseType: 'blob' })
  const url = URL.createObjectURL(response.data), link = document.createElement('a')
  try { link.href = url; link.download = file.filename; link.hidden = true; document.body.append(link); link.click() }
  finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000) }
}
export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) return error.response?.data?.message || '暂时无法完成操作，请检查网络后重试'
  return error instanceof Error ? error.message : '操作失败，请稍后重试'
}
