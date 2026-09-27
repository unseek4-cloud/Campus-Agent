export interface CurrentUser {
  id: number
  username: string
  displayName: string
  role: 'STUDENT' | 'ADMIN'
  studentNo: string | null
}
