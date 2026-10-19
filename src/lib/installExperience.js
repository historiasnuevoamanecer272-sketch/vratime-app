const key = 'vratime-install-experience-v1';
const cooldown = 30 * 86400000;
export const installMilestoneEvent = 'vratime-install-milestone';
const milestones = new Set(['listing', 'transaction', 'fulfilled-task']);

function read(storage) {
  try { return JSON.parse(storage?.getItem(key) || '{}') || {}; }
  catch { return {}; }
}
function write(storage, state) {
  try { storage?.setItem(key, JSON.stringify(state)); }
  catch { /* Private browsing may disable storage; installation stays optional. */ }
}
export function canOfferInstall(storage, now = Date.now()) {
  const state = read(storage);
  return state.meaningful === true && (!Number.isFinite(state.dismissedAt) || now - state.dismissedAt >= cooldown);
}
export function recordInstallMilestone(storage, milestone) {
  if (!milestones.has(milestone)) return false;
  write(storage, { ...read(storage), meaningful: true });
  return true;
}
export function recordInstallDismissal(storage, now = Date.now()) {
  write(storage, { ...read(storage), dismissedAt: now });
}
export function installDeviceStorage() {
  try { return window.localStorage; } catch { return null; }
}
export function markInstallMilestone(milestone) {
  if (!recordInstallMilestone(installDeviceStorage(), milestone)) return;
  window.dispatchEvent(new Event(installMilestoneEvent));
}
