import { httpClient } from '../../../shared/http/client'
import type { ApiResponse, RagChatResponse } from '../types'
import type { Feedback } from '../feedback/api'

export interface Conversation { id: number; title: string; createdAt: string; updatedAt: string }
export interface SavedMessage {
  id: number; requestId: string; role: 'USER' | 'ASSISTANT'; content: string
  response: RagChatResponse | null; createdAt: string; feedback?: Feedback | null
}
export interface SavedMessages { messages: SavedMessage[]; pending: boolean }
export const historyApi = {
  async list() { return (await httpClient.get<ApiResponse<Conversation[]>>('/chat/conversations')).data.data },
  async create() { return (await httpClient.post<ApiResponse<Conversation>>('/chat/conversations')).data.data },
  async messages(id: number) { return (await httpClient.get<ApiResponse<SavedMessages>>(`/chat/conversations/${id}/messages`)).data.data },
  async delete(id: number) { await httpClient.delete(`/chat/conversations/${id}`) },
  async regenerate(id: number) { return (await httpClient.post<ApiResponse<RagChatResponse>>(`/chat/messages/${id}/regenerate`, { requestId: crypto.randomUUID() })).data.data },
  async share(id: number, messageIds: number[]) { return (await httpClient.post<ApiResponse<{ token: string }>>(`/chat/conversations/${id}/shares`, { ttlDays: 30, messageIds })).data.data },
  async revoke(id: number, token: string) { await httpClient.delete(`/chat/conversations/${id}/shares/${token}`) },
}
