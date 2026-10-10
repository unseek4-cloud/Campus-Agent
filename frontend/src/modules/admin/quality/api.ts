import { httpClient } from '../../../shared/http/client'
import type { ApiResponse, RagChatResponse } from '../../knowledge/types'
import type { Rating } from '../../knowledge/feedback/api'
export interface QualityFilter { rating?: string; startDate?: string; endDate?: string }
export interface QualitySummary { total: number; positive: number; negative: number; positiveRate: number; accessScope: 'ALL' | 'ASSIGNED'; trend: { date: string; positive: number; negative: number }[] }
export interface QualityRecord { id: number; messageId: number; question: string; answer: string; response: RagChatResponse | null; rating: Rating; updatedAt: string; issueType: string; handlingStatus: string; adminNote: string; reviewedAt: string | null; version: number }
export const issues: Record<string, string> = { UNCLASSIFIED: '待分类', KNOWLEDGE_GAP: '知识库内容不足', RETRIEVAL_MISMATCH: 'RAG 检索不准确', ANSWER_QUALITY: '回答表达或内容问题', OTHER: '其他' }
export const statuses: Record<string, string> = { OPEN: '待处理', IN_PROGRESS: '处理中', RESOLVED: '已处理' }
export const qualityApi = {
  async summary(params: QualityFilter) { return (await httpClient.get<ApiResponse<QualitySummary>>('/admin/ai-quality/summary', { params })).data.data },
  async list(params: QualityFilter & { page: number; pageSize: number }) { return (await httpClient.get<ApiResponse<{ items: QualityRecord[]; total: number }>>('/admin/ai-quality/feedback', { params })).data.data },
  async review(id: number, data: { issueType: string; handlingStatus: string; adminNote: string; version: number }) { await httpClient.patch(`/admin/ai-quality/feedback/${id}`, data) },
}
