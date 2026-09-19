export interface ApiResponse<T> {
  code: string
  message: string
  data: T
  requestId: string
  timestamp: string
}

export interface KnowledgeSearchRequest {
  query: string
  topK: number
  knowledgeBaseId?: string
}

export interface KnowledgeSearchResult {
  rank: number
  content: string
  score: number
  rerankScore: number | null
  evidenceScore: number | null
  evidenceText: string | null
  finalScore: number | null
  documentId: string
  knowledgeBaseId: string
  fileName: string
  fileType: string
  pageNumber: number | null
  chunkIndex: number
  source: string
}

export interface KnowledgeSearchResponse {
  query: string
  results: KnowledgeSearchResult[]
}
