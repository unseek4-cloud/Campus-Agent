import type { ServiceItem, ServiceProgress, ServiceProgressStorage, ServiceStep } from '../types'

export const PROGRESS_KEY_PREFIX = 'campusagent:service-progress:'
export const STEP_ACTION_DELAY = 500
export const FLOW_UPDATED_NOTICE = '该办事流程已更新，已根据最新流程重新开始引导。'
type Definition = { service: ServiceItem; steps: ServiceStep[] }
type Listener = (code: string) => void

export function orderSteps(steps: ServiceStep[]): ServiceStep[] {
  const seen = new Set<number>()
  return [...steps].filter(step => {
    if (!Number.isSafeInteger(step.order) || step.order <= 0 || seen.has(step.order)) return false
    seen.add(step.order)
    return true
  }).sort((a, b) => a.order - b.order)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Recovery never infers completion from the server's currentStep or from materials. */
export function reconcileProgress(service: ServiceItem, steps: ServiceStep[], raw: unknown, now: string) {
  const orders = orderSteps(steps).map(step => step.order)
  const saved = record(raw) && raw.serviceCode === service.code ? raw : null
  const changed = !!saved && (saved.serviceVersion !== service.version || saved.serviceId !== service.id)
  const valid = changed ? null : saved
  const savedCompleted = Array.isArray(valid?.completedSteps) ? valid.completedSteps : []
  // A sequential guide can only retain a completed prefix. Never skip a new/unfinished step.
  const completedSteps: number[] = []
  for (const order of orders) {
    if (!savedCompleted.includes(order)) break
    completedSteps.push(order)
  }
  const completed = orders.length > 0 && completedSteps.length === orders.length
  const materialNames = new Set(service.materials.map(material => material.name))
  const checkedMaterials = Array.isArray(valid?.checkedMaterials)
    ? [...new Set(valid.checkedMaterials.filter((name): name is string => typeof name === 'string' && materialNames.has(name)))] : []
  const progress: ServiceProgress = {
    serviceCode: service.code, serviceId: service.id, serviceVersion: service.version,
    currentStep: completed ? orders[orders.length - 1] : orders[completedSteps.length] ?? null,
    completedSteps, checkedMaterials, completed, updatedAt: now,
  }
  return { progress, notice: changed ? FLOW_UPDATED_NOTICE : '' }
}

function browserStorage(): ServiceProgressStorage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage }
  catch { return null }
}

/** One store per browser app: repeated cards share progress and click protection. */
export class ServiceProgressStore {
  private readonly definitions = new Map<string, Definition>()
  private readonly progress = new Map<string, ServiceProgress>()
  private readonly notices = new Map<string, string>()
  private readonly unavailable = new Set<string>()
  private readonly actionAt = new Map<string, number>()
  private readonly listeners = new Set<Listener>()

  constructor(
    private readonly storage: () => ServiceProgressStorage | null = browserStorage,
    private readonly clock: () => number = Date.now,
  ) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(code: string) { this.listeners.forEach(listener => listener(code)) }
  private timestamp() { return new Date(this.clock()).toISOString() }
  private copy(value: ServiceProgress): ServiceProgress {
    return { ...value, completedSteps: [...value.completedSteps], checkedMaterials: [...value.checkedMaterials] }
  }
  peek(code: string): ServiceProgress | undefined {
    const value = this.progress.get(code)
    return value ? this.copy(value) : undefined
  }
  getNotice(code: string) { return this.notices.get(code) ?? '' }
  isPersistent(code: string) { return !this.unavailable.has(code) }

  getProgress(service: ServiceItem, steps: ServiceStep[]): ServiceProgress {
    const previous = this.definitions.get(service.code)
    // An older chat card must not overwrite a newer guide opened in this conversation.
    if (previous && previous.service.version > service.version) return this.peek(service.code)!
    let raw: unknown = this.progress.get(service.code)
    if (!raw) {
      try {
        const storage = this.storage()
        if (!storage) this.unavailable.add(service.code)
        const json = storage?.getItem(PROGRESS_KEY_PREFIX + service.code)
        raw = json ? JSON.parse(json) : null
      } catch { raw = null }
    }
    this.definitions.set(service.code, { service, steps: orderSteps(steps) })
    const result = reconcileProgress(service, steps, raw, this.timestamp())
    if (result.notice) this.notices.set(service.code, result.notice)
    this.saveProgress(result.progress)
    return this.peek(service.code)!
  }

  private saveProgress(value: ServiceProgress) {
    this.progress.set(value.serviceCode, this.copy(value))
    try {
      const storage = this.storage()
      if (!storage) throw new Error('Storage unavailable')
      storage.setItem(PROGRESS_KEY_PREFIX + value.serviceCode, JSON.stringify(value))
      this.unavailable.delete(value.serviceCode)
    } catch { this.unavailable.add(value.serviceCode) }
    this.emit(value.serviceCode)
  }

  private allowAction(code: string) {
    const now = this.clock()
    const last = this.actionAt.get(code)
    if (last !== undefined && now - last < STEP_ACTION_DELAY) return false
    this.actionAt.set(code, now)
    return true
  }

  completeCurrentStep(code: string, expectedStep: number | null): boolean {
    const state = this.peek(code), definition = this.definitions.get(code)
    if (!state || !definition || state.completed || state.currentStep === null || state.currentStep !== expectedStep) return false
    const index = definition.steps.findIndex(step => step.order === state.currentStep)
    if (index < 0 || !this.allowAction(code)) return false
    state.completedSteps = [...new Set([...state.completedSteps, state.currentStep])]
    state.currentStep = definition.steps[index + 1]?.order ?? state.currentStep
    state.completed = index === definition.steps.length - 1
    state.updatedAt = this.timestamp()
    this.saveProgress(state)
    return true
  }

  goPreviousStep(code: string): boolean {
    const state = this.peek(code), definition = this.definitions.get(code)
    if (!state || !definition || state.currentStep === null) return false
    const index = definition.steps.findIndex(step => step.order === state.currentStep)
    // From the completed screen, reopen the last step; otherwise go back one step.
    const targetIndex = state.completed ? index : index - 1
    if (targetIndex < 0 || !this.allowAction(code)) return false
    state.currentStep = definition.steps[targetIndex].order
    state.completedSteps = definition.steps.slice(0, targetIndex).map(step => step.order)
    state.completed = false
    state.updatedAt = this.timestamp()
    this.saveProgress(state)
    return true
  }

  setMaterialChecked(code: string, name: string, checked: boolean) {
    const state = this.peek(code), definition = this.definitions.get(code)
    if (!state || !definition?.service.materials.some(material => material.name === name)) return
    state.checkedMaterials = checked ? [...new Set([...state.checkedMaterials, name])]
      : state.checkedMaterials.filter(material => material !== name)
    state.updatedAt = this.timestamp()
    this.saveProgress(state)
  }

  resetProgress(code: string) {
    const definition = this.definitions.get(code)
    if (!definition) return
    this.notices.delete(code)
    this.actionAt.delete(code)
    this.saveProgress(reconcileProgress(definition.service, definition.steps, null, this.timestamp()).progress)
  }

  clearProgress(code: string) {
    try { this.storage()?.removeItem(PROGRESS_KEY_PREFIX + code) }
    catch { this.unavailable.add(code) }
    const definition = this.definitions.get(code)
    if (definition) this.progress.set(code, reconcileProgress(definition.service, definition.steps, null, this.timestamp()).progress)
    else this.progress.delete(code)
    this.notices.delete(code)
    this.actionAt.delete(code)
    this.emit(code)
  }
}

export const serviceProgressStore = new ServiceProgressStore()
