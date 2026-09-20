import axios from 'axios'
import { httpClient } from '../../shared/http/client'
import type { ApiResponse, DocumentItem, DocumentPage, Overview, UploadResult } from './types'

export function errorText(error: unknown): string {
  if (axios.isAxiosError<ApiResponse<null>>(error)) return error.response?.data?.message || '请求失败，请稍后重试'
  return error instanceof Error ? error.message : '请求失败，请稍后重试'
}

export async function listDocuments(params: { search?: string; type?: string; status?: string; page?: number; pageSize?: number }): Promise<DocumentPage> {
  return (await httpClient.get<ApiResponse<DocumentPage>>('/admin/documents', { params })).data.data
}
export async function getOverview(): Promise<Overview> {
  return (await httpClient.get<ApiResponse<Overview>>('/admin/overview')).data.data
}
export async function getAdminConfig(): Promise<{ maxUploadSizeMb: number }> {
  return (await httpClient.get<ApiResponse<{ maxUploadSizeMb: number }>>('/admin/config')).data.data
}
export async function getDocument(id: string): Promise<DocumentItem> {
  return (await httpClient.get<ApiResponse<DocumentItem>>(`/admin/documents/${id}`)).data.data
}
export async function getDocumentProgress(id: string): Promise<DocumentItem> {
  return (await httpClient.get<ApiResponse<DocumentItem>>(`/admin/documents/${id}/progress`)).data.data
}
export async function uploadDocument(file: File, onProgress: (value: number) => void): Promise<UploadResult> {
  const body = new FormData(); body.append('file', file)
  return (await httpClient.post<ApiResponse<UploadResult>>('/admin/documents', body, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000,
    onUploadProgress: (event) => { if (event.total) onProgress(Math.round(event.loaded / event.total * 100)) },
  })).data.data
}
export async function renameDocument(id: string, name: string): Promise<DocumentItem> {
  return (await httpClient.patch<ApiResponse<DocumentItem>>(`/admin/documents/${id}/name`, { name })).data.data
}
export async function deleteDocument(id: string): Promise<void> {
  await httpClient.delete(`/admin/documents/${id}`)
}
export async function reprocessDocument(id: string): Promise<DocumentItem> {
  return (await httpClient.post<ApiResponse<DocumentItem>>(`/admin/documents/${id}/reprocess`)).data.data
}

export function ocrText(value: DocumentItem['ocrProvider']): string {
  return ({ none: '无需 OCR', qwen: 'Qwen OCR', paddle: 'PaddleOCR', qwen_to_paddle: 'Qwen → PaddleOCR', mixed: '混合识别' })[value] || '待识别'
}

export function stageText(value: DocumentItem['parseStatus']): string {
  return ({ UPLOADED: '已上传', PARSING: '解析中', OCR_PROCESSING: 'OCR 识别中', CHUNKING: '文本分块中', EMBEDDING: '向量化中', INDEXING: '入库中', COMPLETED: '已入库', FAILED: '处理失败' })[value] || '处理中'
}

export function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`
}
export function dateText(value: string): string {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
}
