export const enableAutomaticPwaRefresh = () => {
  if (!('serviceWorker' in navigator)) return

  const wasControlledAtStartup = Boolean(navigator.serviceWorker.controller)
  let refreshing = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!wasControlledAtStartup || refreshing) return
    refreshing = true
    window.location.reload()
  })
}
