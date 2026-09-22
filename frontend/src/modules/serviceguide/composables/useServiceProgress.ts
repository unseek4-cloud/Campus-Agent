import { computed, onScopeDispose, ref, watch } from 'vue'
import type { ServiceItem, ServiceProgress, ServiceStep } from '../types'
import { orderSteps, serviceProgressStore as store, STEP_ACTION_DELAY } from '../services/serviceProgress'

export function useServiceProgress(props: { service: ServiceItem; steps: ServiceStep[]; trackProgress: boolean }) {
  const progress = ref<ServiceProgress>()
  const notice = ref('')
  const persistent = ref(true)
  const busy = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  const refresh = () => {
    progress.value = store.peek(props.service.code)
    notice.value = store.getNotice(props.service.code)
    persistent.value = store.isPersistent(props.service.code)
  }
  const unsubscribe = store.subscribe(code => {
    if (props.trackProgress && code === props.service.code) refresh()
  })
  watch(() => [props.service, props.steps, props.trackProgress], () => {
    if (props.trackProgress) { store.getProgress(props.service, props.steps); refresh() }
    else progress.value = undefined
  }, { immediate: true, deep: true })
  onScopeDispose(() => { unsubscribe(); clearTimeout(timer) })

  const steps = computed(() => orderSteps(props.steps))
  const stale = computed(() => !!progress.value && (progress.value.serviceVersion !== props.service.version || progress.value.serviceId !== props.service.id))
  const current = computed(() => steps.value.find(step => step.order === progress.value?.currentStep))
  const percentage = computed(() => steps.value.length ? Math.round((progress.value?.completedSteps.length ?? 0) / steps.value.length * 100) : 0)
  const canGoBack = computed(() => !!progress.value && (progress.value.completed || steps.value[0]?.order !== progress.value.currentStep))
  function navigate(action: 'complete' | 'previous') {
    if (busy.value || stale.value || !progress.value) return
    const changed = action === 'complete'
      ? store.completeCurrentStep(props.service.code, progress.value.currentStep)
      : store.goPreviousStep(props.service.code)
    if (changed) {
      busy.value = true
      clearTimeout(timer)
      timer = setTimeout(() => { busy.value = false }, STEP_ACTION_DELAY)
    }
  }
  function reset() {
    if (stale.value) return
    clearTimeout(timer)
    busy.value = false
    store.resetProgress(props.service.code)
  }
  function toggleMaterial(name: string, event: Event) {
    if (!stale.value && event.target instanceof HTMLInputElement) store.setMaterialChecked(props.service.code, name, event.target.checked)
  }
  return { progress, notice, persistent, busy, steps, stale, current, percentage, canGoBack, navigate, reset, toggleMaterial }
}
