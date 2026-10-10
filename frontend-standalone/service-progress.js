// Generated from frontend/src/modules/serviceguide/services/serviceProgress.ts.
// Update with: node scripts/sync-standalone-progress.mjs
(() => {
"use strict";
const PROGRESS_KEY_PREFIX = 'campusagent:service-progress:';
const STEP_ACTION_DELAY = 500;
const FLOW_UPDATED_NOTICE = '该办事流程已更新，已根据最新流程重新开始引导。';
function orderSteps(steps) {
    const seen = new Set();
    return [...steps].filter(step => {
        if (!Number.isSafeInteger(step.order) || step.order <= 0 || seen.has(step.order))
            return false;
        seen.add(step.order);
        return true;
    }).sort((a, b) => a.order - b.order);
}
function record(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Recovery never infers completion from the server's currentStep or from materials. */
function reconcileProgress(service, steps, raw, now) {
    const orders = orderSteps(steps).map(step => step.order);
    const saved = record(raw) && raw.serviceCode === service.code ? raw : null;
    const changed = !!saved && (saved.serviceVersion !== service.version || saved.serviceId !== service.id);
    const valid = changed ? null : saved;
    const savedCompleted = Array.isArray(valid?.completedSteps) ? valid.completedSteps : [];
    // A sequential guide can only retain a completed prefix. Never skip a new/unfinished step.
    const completedSteps = [];
    for (const order of orders) {
        if (!savedCompleted.includes(order))
            break;
        completedSteps.push(order);
    }
    const completed = orders.length > 0 && completedSteps.length === orders.length;
    const materialNames = new Set(service.materials.map(material => material.name));
    const checkedMaterials = Array.isArray(valid?.checkedMaterials)
        ? [...new Set(valid.checkedMaterials.filter((name) => typeof name === 'string' && materialNames.has(name)))] : [];
    const progress = {
        serviceCode: service.code, serviceId: service.id, serviceVersion: service.version,
        currentStep: completed ? orders[orders.length - 1] : orders[completedSteps.length] ?? null,
        completedSteps, checkedMaterials, completed, updatedAt: now,
    };
    return { progress, notice: changed ? FLOW_UPDATED_NOTICE : '' };
}
function browserStorage() {
    try {
        return typeof window === 'undefined' ? null : window.localStorage;
    }
    catch {
        return null;
    }
}
/** One store per browser app: repeated cards share progress and click protection. */
class ServiceProgressStore {
    storage;
    clock;
    definitions = new Map();
    progress = new Map();
    notices = new Map();
    unavailable = new Set();
    actionAt = new Map();
    listeners = new Set();
    constructor(storage = browserStorage, clock = Date.now) {
        this.storage = storage;
        this.clock = clock;
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    emit(code) { this.listeners.forEach(listener => listener(code)); }
    timestamp() { return new Date(this.clock()).toISOString(); }
    copy(value) {
        return { ...value, completedSteps: [...value.completedSteps], checkedMaterials: [...value.checkedMaterials] };
    }
    peek(code) {
        const value = this.progress.get(code);
        return value ? this.copy(value) : undefined;
    }
    getNotice(code) { return this.notices.get(code) ?? ''; }
    isPersistent(code) { return !this.unavailable.has(code); }
    getProgress(service, steps) {
        const previous = this.definitions.get(service.code);
        // An older chat card must not overwrite a newer guide opened in this conversation.
        if (previous && previous.service.version > service.version)
            return this.peek(service.code);
        let raw = this.progress.get(service.code);
        if (!raw) {
            try {
                const storage = this.storage();
                if (!storage)
                    this.unavailable.add(service.code);
                const json = storage?.getItem(PROGRESS_KEY_PREFIX + service.code);
                raw = json ? JSON.parse(json) : null;
            }
            catch {
                raw = null;
            }
        }
        this.definitions.set(service.code, { service, steps: orderSteps(steps) });
        const result = reconcileProgress(service, steps, raw, this.timestamp());
        if (result.notice)
            this.notices.set(service.code, result.notice);
        this.saveProgress(result.progress);
        return this.peek(service.code);
    }
    saveProgress(value) {
        this.progress.set(value.serviceCode, this.copy(value));
        try {
            const storage = this.storage();
            if (!storage)
                throw new Error('Storage unavailable');
            storage.setItem(PROGRESS_KEY_PREFIX + value.serviceCode, JSON.stringify(value));
            this.unavailable.delete(value.serviceCode);
        }
        catch {
            this.unavailable.add(value.serviceCode);
        }
        this.emit(value.serviceCode);
    }
    allowAction(code) {
        const now = this.clock();
        const last = this.actionAt.get(code);
        if (last !== undefined && now - last < STEP_ACTION_DELAY)
            return false;
        this.actionAt.set(code, now);
        return true;
    }
    completeCurrentStep(code, expectedStep) {
        const state = this.peek(code), definition = this.definitions.get(code);
        if (!state || !definition || state.completed || state.currentStep === null || state.currentStep !== expectedStep)
            return false;
        const index = definition.steps.findIndex(step => step.order === state.currentStep);
        if (index < 0 || !this.allowAction(code))
            return false;
        state.completedSteps = [...new Set([...state.completedSteps, state.currentStep])];
        state.currentStep = definition.steps[index + 1]?.order ?? state.currentStep;
        state.completed = index === definition.steps.length - 1;
        state.updatedAt = this.timestamp();
        this.saveProgress(state);
        return true;
    }
    goPreviousStep(code) {
        const state = this.peek(code), definition = this.definitions.get(code);
        if (!state || !definition || state.currentStep === null)
            return false;
        const index = definition.steps.findIndex(step => step.order === state.currentStep);
        // From the completed screen, reopen the last step; otherwise go back one step.
        const targetIndex = state.completed ? index : index - 1;
        if (targetIndex < 0 || !this.allowAction(code))
            return false;
        state.currentStep = definition.steps[targetIndex].order;
        state.completedSteps = definition.steps.slice(0, targetIndex).map(step => step.order);
        state.completed = false;
        state.updatedAt = this.timestamp();
        this.saveProgress(state);
        return true;
    }
    setMaterialChecked(code, name, checked) {
        const state = this.peek(code), definition = this.definitions.get(code);
        if (!state || !definition?.service.materials.some(material => material.name === name))
            return;
        state.checkedMaterials = checked ? [...new Set([...state.checkedMaterials, name])]
            : state.checkedMaterials.filter(material => material !== name);
        state.updatedAt = this.timestamp();
        this.saveProgress(state);
    }
    resetProgress(code) {
        const definition = this.definitions.get(code);
        if (!definition)
            return;
        this.notices.delete(code);
        this.actionAt.delete(code);
        this.saveProgress(reconcileProgress(definition.service, definition.steps, null, this.timestamp()).progress);
    }
    clearProgress(code) {
        try {
            this.storage()?.removeItem(PROGRESS_KEY_PREFIX + code);
        }
        catch {
            this.unavailable.add(code);
        }
        const definition = this.definitions.get(code);
        if (definition)
            this.progress.set(code, reconcileProgress(definition.service, definition.steps, null, this.timestamp()).progress);
        else
            this.progress.delete(code);
        this.notices.delete(code);
        this.actionAt.delete(code);
        this.emit(code);
    }
}
const serviceProgressStore = new ServiceProgressStore();

window.CampusServiceProgress = { ServiceProgressStore, orderSteps, FLOW_UPDATED_NOTICE };
})();
