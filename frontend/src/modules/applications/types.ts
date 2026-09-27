export type ApplicationStatus = 'SUBMITTED' | 'REVIEWING' | 'NEED_MORE' | 'APPROVED' | 'REJECTED' | 'COMPLETED'
export const statusLabels: Record<ApplicationStatus, string> = {
  SUBMITTED: '已提交', REVIEWING: '审核中', NEED_MORE: '待补充材料', APPROVED: '已通过', REJECTED: '未通过', COMPLETED: '已办结',
}
export interface ApplicationRecord {
  id: number; applicationNo: string; serviceItemId: number; serviceName: string; userId: number
  username: string; applicantName: string; studentNo: string; status: ApplicationStatus
  studentRemark: string; adminRemark: string | null; version: number
  submittedAt: string; updatedAt: string; completedAt: string | null
}
export interface ApplicationAttachment { id: string; filename: string; contentType: string; fileSize: number; uploadedAt: string }
export interface ApplicationEvent { id: number; fromStatus: ApplicationStatus | null; toStatus: ApplicationStatus; actorName: string; actorRole: string; remark: string; createdAt: string }
export interface ApplicationDetail { application: ApplicationRecord; attachments: ApplicationAttachment[]; events: ApplicationEvent[] }
export interface ApplicationPage { items: ApplicationRecord[]; total: number; page: number; pageSize: number }
export interface UploadConfig { maxUploadSizeMb: number; maxTotalSizeMb: number; maxFiles: number; extensions: string[] }
export function dateText(value: string | null) { return value ? value.replace('T', ' ').slice(0, 19) : '—' }
