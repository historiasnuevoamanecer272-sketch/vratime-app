let pending = false
let registration
let environment
let requested = false
const listeners = new Set()
const announce = () => { pending = true; for (const listener of listeners) listener(true) }
export const subscribePwaUpdate = listener => { listeners.add(listener); listener(pending); return () => listeners.delete(listener) }
export const getPwaUpdateState = () => pending
// Kept as the existing entrypoint name; activation now preserves current input.
export const enableAutomaticPwaRefresh = () => {
  environment = window
  const worker = environment.navigator?.serviceWorker
  if (!worker) return () => {}
  const controlled = Boolean(worker.controller)
  let active = true
  const changed = () => {
    if (requested) { environment.location.reload(); return }
    if (controlled) announce()
  }
  const installingChanged = () => { if (registration?.waiting && worker.controller) announce() }
  const updateFound = () => registration?.installing?.addEventListener('statechange', installingChanged)
  worker.addEventListener('controllerchange', changed)
  Promise.resolve(worker.getRegistration?.()).then(value => {
    if (!active || !value) return
    registration = value
    installingChanged()
    registration.addEventListener('updatefound', updateFound)
  }).catch(() => {})
  return () => { active = false; worker.removeEventListener('controllerchange', changed); registration?.removeEventListener('updatefound', updateFound); registration?.installing?.removeEventListener('statechange', installingChanged) }
}
export const applyPwaUpdate = () => {
  if (!pending || !environment) return false
  requested = true
  if (registration?.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' })
  else environment.location.reload()
  return true
}
