import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Compile the standalone domain module using the existing compiler; no new test dependencies.
const source = await readFile(new URL('../src/modules/serviceguide/services/serviceProgress.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
const { ServiceProgressStore, PROGRESS_KEY_PREFIX, STEP_ACTION_DELAY, FLOW_UPDATED_NOTICE } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const service = (code = 'TEST_SERVICE', version = 1) => ({ id: 1, code, version, materials: [{ name: '身份证明' }, { name: '申请表' }] })
const steps = (orders = [1, 2, 3, 4]) => orders.map(order => ({ order, title: `步骤 ${order}`, requiredMaterials: [] }))
function setup(storageOverride) {
  const saved = new Map()
  const storage = storageOverride ?? { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) }
  let now = Date.parse('2026-09-22T00:00:00Z')
  const create = () => new ServiceProgressStore(() => storage, () => now)
  const store = create()
  const tick = () => { now += STEP_ACTION_DELAY + 1 }
  const complete = (code = 'TEST_SERVICE') => { tick(); return store.completeCurrentStep(code, store.peek(code).currentStep) }
  return { store, saved, storage, create, tick, complete }
}

test('1: four steps begin at the first step without inferred completion', () => {
  const { store } = setup()
  const state = store.getProgress(service(), steps())
  assert.equal(state.currentStep, 1); assert.deepEqual(state.completedSteps, []); assert.equal(state.completed, false)
})
test('2: completing the current step advances and persists exactly once', () => {
  const { store, complete, saved } = setup()
  store.getProgress(service(), steps()); assert.equal(complete(), true)
  assert.equal(store.peek('TEST_SERVICE').currentStep, 2)
  assert.deepEqual(JSON.parse(saved.get(PROGRESS_KEY_PREFIX + 'TEST_SERVICE')).completedSteps, [1])
})
test('3: going back reopens the previous step and removes later completion', () => {
  const { store, complete, tick } = setup()
  store.getProgress(service(), steps()); complete(); complete(); tick()
  assert.equal(store.goPreviousStep('TEST_SERVICE'), true)
  assert.equal(store.peek('TEST_SERVICE').currentStep, 2)
  assert.deepEqual(store.peek('TEST_SERVICE').completedSteps, [1])
  tick(); store.goPreviousStep('TEST_SERVICE'); tick()
  assert.equal(store.goPreviousStep('TEST_SERVICE'), false)
})
test('4: final completion is 100%, bounded, and can reopen the last step', () => {
  const { store, complete, tick } = setup()
  store.getProgress(service(), steps()); for (let i = 0; i < 4; i++) complete()
  const state = store.peek('TEST_SERVICE')
  assert.equal(state.completed, true); assert.equal(state.currentStep, 4)
  assert.equal(state.completedSteps.length / 4 * 100, 100); assert.equal(complete(), false)
  tick(); store.goPreviousStep('TEST_SERVICE')
  assert.deepEqual(store.peek('TEST_SERVICE').completedSteps, [1, 2, 3])
  assert.equal(store.peek('TEST_SERVICE').completed, false)
})
test('5: restart clears completion and materials and persists initial state', () => {
  const { store, complete, create } = setup()
  store.getProgress(service(), steps()); complete(); store.setMaterialChecked('TEST_SERVICE', '申请表', true)
  store.resetProgress('TEST_SERVICE')
  const state = create().getProgress(service(), steps())
  assert.equal(state.currentStep, 1); assert.deepEqual(state.completedSteps, []); assert.deepEqual(state.checkedMaterials, [])
})
test('6: two service codes keep independent progress', () => {
  const { store, complete } = setup()
  store.getProgress(service('ONE'), steps()); complete('ONE'); complete('ONE')
  const other = store.getProgress(service('TWO'), steps())
  assert.equal(other.currentStep, 1); assert.equal(store.peek('ONE').currentStep, 3)
})
test('7: a new store restores progress and material checks', () => {
  const { store, complete, create } = setup()
  store.getProgress(service(), steps()); complete(); complete(); store.setMaterialChecked('TEST_SERVICE', '申请表', true)
  const restored = create().getProgress(service(), steps())
  assert.equal(restored.currentStep, 3); assert.deepEqual(restored.completedSteps, [1, 2]); assert.deepEqual(restored.checkedMaterials, ['申请表'])
})
test('8: deleted completed/current steps are filtered and a legal step is selected', () => {
  const { store, complete, create } = setup()
  store.getProgress(service(), steps()); complete(); complete()
  const restored = create().getProgress(service(), steps([1, 4]))
  assert.equal(restored.currentStep, 4); assert.deepEqual(restored.completedSteps, [1]); assert.equal(restored.completed, false)
})
test('9: unsorted, nonconsecutive orders advance and go back by array position', () => {
  const { store, complete, tick } = setup()
  assert.equal(store.getProgress(service(), steps([30, 10, 20])).currentStep, 10)
  complete(); assert.equal(store.peek('TEST_SERVICE').currentStep, 20)
  complete(); assert.equal(store.peek('TEST_SERVICE').currentStep, 30)
  tick(); store.goPreviousStep('TEST_SERVICE'); assert.equal(store.peek('TEST_SERVICE').currentStep, 20)
})
test('10: no steps have null current step and no navigation', () => {
  const { store } = setup()
  const state = store.getProgress(service(), [])
  assert.equal(state.currentStep, null); assert.equal(state.completed, false)
  assert.equal(store.completeCurrentStep('TEST_SERVICE', null), false); assert.equal(store.goPreviousStep('TEST_SERVICE'), false)
})
test('single step completes immediately', () => {
  const { store, complete } = setup()
  store.getProgress(service(), steps([10])); complete(); assert.equal(store.peek('TEST_SERVICE').completed, true)
})
test('broken JSON and malformed fields safely recover', () => {
  for (const value of ['{broken', 'null', '[]', '42', JSON.stringify({ serviceCode: 'TEST_SERVICE', serviceVersion: 1, serviceId: 1, completedSteps: 'all', checkedMaterials: {}, currentStep: 999 })]) {
    const { store, saved } = setup(); saved.set(PROGRESS_KEY_PREFIX + 'TEST_SERVICE', value)
    assert.equal(store.getProgress(service(), steps()).currentStep, 1)
  }
})
test('storage access denied or quota exceeded retains in-memory navigation', () => {
  const fail = () => { throw Error('Storage denied') }
  const { store, complete } = setup({ getItem: fail, setItem: fail, removeItem: fail })
  store.getProgress(service(), steps()); complete()
  assert.equal(store.peek('TEST_SERVICE').currentStep, 2); assert.equal(store.isPersistent('TEST_SERVICE'), false)
  store.clearProgress('TEST_SERVICE'); assert.equal(store.peek('TEST_SERVICE').currentStep, 1)
  const absent = new ServiceProgressStore(() => null)
  absent.getProgress(service(), steps()); assert.equal(absent.isPersistent('TEST_SERVICE'), false)
})
test('version changes reset even when orders are reused', () => {
  const { store, complete, create } = setup()
  store.getProgress(service(), steps()); complete()
  const next = create(); const state = next.getProgress(service('TEST_SERVICE', 2), steps())
  assert.equal(state.currentStep, 1); assert.deepEqual(state.completedSteps, [])
  assert.equal(next.getNotice('TEST_SERVICE'), FLOW_UPDATED_NOTICE)
})
test('recreated service IDs invalidate prior confirmations', () => {
  const { store, complete, create } = setup()
  store.getProgress(service(), steps()); complete()
  const state = create().getProgress({ ...service(), id: 2 }, steps())
  assert.equal(state.currentStep, 1); assert.deepEqual(state.completedSteps, [])
})
test('new steps after an entirely completed guide reopen at the first unfinished step', () => {
  const { store, complete, create } = setup()
  store.getProgress(service(), steps()); for (let i = 0; i < 4; i++) complete()
  const state = create().getProgress(service(), steps([1, 2, 3, 4, 5]))
  assert.equal(state.completed, false); assert.equal(state.currentStep, 5)
})
test('double click and stale button events cannot skip steps', () => {
  const { store, complete, tick } = setup()
  store.getProgress(service(), steps()); complete()
  assert.equal(store.completeCurrentStep('TEST_SERVICE', 2), false)
  tick(); assert.equal(store.completeCurrentStep('TEST_SERVICE', 1), false)
  assert.equal(store.peek('TEST_SERVICE').currentStep, 2); assert.deepEqual(store.peek('TEST_SERVICE').completedSteps, [1])
})
test('material checks never complete steps; duplicates and unknown names are ignored', () => {
  const { store } = setup(); store.getProgress(service(), steps())
  for (const name of ['申请表', '申请表', '身份证明', 'unknown']) store.setMaterialChecked('TEST_SERVICE', name, true)
  assert.deepEqual(store.peek('TEST_SERVICE').checkedMaterials, ['申请表', '身份证明'])
  assert.deepEqual(store.peek('TEST_SERVICE').completedSteps, [])
})
test('same-service subscribers see updates and older cards cannot replace newer definitions', () => {
  const { store, complete } = setup(); store.getProgress(service('TEST_SERVICE', 2), steps())
  let updates = 0; const unsubscribe = store.subscribe(() => { updates++ })
  complete(); assert.equal(updates, 1)
  const state = store.getProgress(service('TEST_SERVICE', 1), steps())
  assert.equal(state.serviceVersion, 2); assert.equal(state.currentStep, 2)
  unsubscribe(); complete(); assert.equal(updates, 1)
})
test('clearProgress deletes only the specified storage entry', () => {
  const { store, saved } = setup(); store.getProgress(service('ONE'), steps()); store.getProgress(service('TWO'), steps())
  store.clearProgress('ONE')
  assert.equal(saved.has(PROGRESS_KEY_PREFIX + 'ONE'), false); assert.equal(saved.has(PROGRESS_KEY_PREFIX + 'TWO'), true)
})
test('cached holes, duplicates and invalid completions cannot skip unfinished steps', () => {
  const { store, saved } = setup()
  saved.set(PROGRESS_KEY_PREFIX + 'TEST_SERVICE', JSON.stringify({ serviceCode: 'TEST_SERVICE', serviceId: 1, serviceVersion: 1, currentStep: 4, completed: true, completedSteps: [1, 1, 3, 999] }))
  const state = store.getProgress(service(), steps())
  assert.deepEqual(state.completedSteps, [1]); assert.equal(state.currentStep, 2); assert.equal(state.completed, false)
})
