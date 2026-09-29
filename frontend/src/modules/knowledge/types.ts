import type { ServiceItem, ServiceStep, ServiceSource } from '../serviceguide/types'

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

export interface RagChatRequest {
  conversationId?: number
  requestId?: string
  query: string
  knowledgeBaseId?: string
  history?: ConversationMessage[]
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface RagSource {
  documentId: string
  fileName: string
  chunkIndex: number
  pageNumber: number | null
  score: number
  rerankScore: number
  content: string
}

export interface RagChatResponse {
  conversationId?: number
  userMessageId?: number
  assistantMessageId?: number
  type: 'QA' | 'SERVICE_GUIDE'
  queryIntent?: 'GENERAL_QA' | 'POLICY_QA' | 'ELIGIBILITY_QA' | 'SERVICE_GUIDE'
  relatedService?: { code: string; name: string } | null
  service?: ServiceItem | null
  steps?: ServiceStep[]
  source?: ServiceSource | null
  currentStep?: number | null
  aiEnhanced?: boolean
  answer: string
  sources: RagSource[]
  retrievalCount: number
  rerankCount: number
  usedContextCount: number
  rewrittenQuery: string
}
