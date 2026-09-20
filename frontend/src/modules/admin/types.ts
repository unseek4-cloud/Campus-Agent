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
  parseStatus: 'UPLOADED' | 'PARSING' | 'OCR_PROCESSING' | 'CHUNKING' | 'EMBEDDING' | 'INDEXING' | 'COMPLETED' | 'FAILED'
  progress: number
  totalPages: number
  processedPages: number
  ocrProvider: 'none' | 'qwen' | 'paddle' | 'qwen_to_paddle' | 'mixed'
}

export interface DocumentPage { items: DocumentItem[]; total: number; page: number; pageSize: number }
export interface Overview { total: number; success: number; processing: number; failed: number; chunks: number; recent: DocumentItem[] }
export interface UploadResult { duplicate: boolean; document: DocumentItem; taskId?: string; documentId?: string; status?: string }
interface Envelope<T> { code: string; message: string; data: T }
export type ApiResponse<T> = Envelope<T>
