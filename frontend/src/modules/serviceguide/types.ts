export interface MaterialAttachment { id: string; filename: string; downloadUrl: string }
export interface ServiceMaterial { id?: string | null; name: string; description: string | null; required: boolean; attachment?: MaterialAttachment | null }
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

/** User confirmations are separate from the school-defined ServiceStep records. */
export interface ServiceProgress {
  serviceCode: string
  serviceId: number | null
  serviceVersion: number
  currentStep: number | null
  completedSteps: number[]
  checkedMaterials: string[]
  completed: boolean
  updatedAt: string
}

/** Replace this adapter with an account API in V1.2 without changing step logic. */
export interface ServiceProgressStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
