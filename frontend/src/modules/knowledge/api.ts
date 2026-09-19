import { httpClient } from '../../shared/http/client'
import type {
  ApiResponse,
  KnowledgeSearchRequest,
  KnowledgeSearchResponse,
  RagChatRequest,
  RagChatResponse,
} from './types'

export async function searchKnowledge(
  request: KnowledgeSearchRequest,
): Promise<KnowledgeSearchResponse> {
  const response = await httpClient.post<ApiResponse<KnowledgeSearchResponse>>(
    '/knowledge/search',
    request,
  )
  return response.data.data
}

export async function chatWithKnowledge(request: RagChatRequest): Promise<RagChatResponse> {
  const response = await httpClient.post<ApiResponse<RagChatResponse>>('/rag/chat', request)
  return response.data.data
}
