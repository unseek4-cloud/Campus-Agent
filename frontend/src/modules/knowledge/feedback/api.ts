import { httpClient } from '../../../shared/http/client'
import type { ApiResponse } from '../types'

export type Rating = 'POSITIVE' | 'NEGATIVE'
export interface Feedback { rating: Rating; updatedAt: string }
export const feedbackApi = {
  async rate(id: number, rating: Rating) { return (await httpClient.put<ApiResponse<Feedback>>(`/chat/messages/${id}/feedback`, { rating })).data.data },
  async cancel(id: number) { await httpClient.delete(`/chat/messages/${id}/feedback`) },
}
