export interface DocumentItem {
  id: string
  knowledgeBaseId: string
  displayName: string
  originalFilename: string
  fileType: string
  mimeType: string
  fileSize: number
  fileHash: string
  status: 'PROCESSING' | 'SUCCESS' | 'FAILED'
  chunkCount: number
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface DocumentPage { items: DocumentItem[]; total: number; page: number; pageSize: number }
export interface Overview { total: number; success: number; processing: number; failed: number; chunks: number; recent: DocumentItem[] }
export interface UploadResult { duplicate: boolean; document: DocumentItem }
interface Envelope<T> { code: string; message: string; data: T }
export type ApiResponse<T> = Envelope<T>
