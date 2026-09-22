export interface ServiceMaterial { name: string; description: string | null; required: boolean }
export interface RecognitionRules { subjects: string[]; actions: string[]; exclusions: string[] }
export interface ServiceItem {
  id: number | null
  code: string
  name: string
  category: string
  description: string | null
  department: string | null
  location: string | null
  officeHours: string | null
  contact: string | null
  requirements: string[]
  materials: ServiceMaterial[]
  recognitionRules: RecognitionRules
  deadline: string | null
  sourceDocumentId: string | null
  sourceTitle: string | null
  sourceUrl: string | null
  sourcePublishTime: string | null
  status: 'DRAFT' | 'ACTIVE' | 'DISABLED'
  isExample: boolean
  version: number
  createdAt?: string | null
  updatedAt?: string | null
}
export interface ServiceStep {
  id?: number | null
  order: number
  title: string
  description: string | null
  responsibleDepartment: string | null
  requiredMaterials: string[]
  location: string | null
  estimatedTime: string | null
}
export interface ServiceSource { title: string | null; documentId: string | null; publishTime: string | null; url: string | null }
export interface ServiceDetail { service: ServiceItem; steps: ServiceStep[] }
