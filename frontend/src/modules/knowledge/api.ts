import { httpClient } from '../../shared/http/client'
import type {
  ApiResponse,
  KnowledgeSearchRequest,
  KnowledgeSearchResponse,
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
