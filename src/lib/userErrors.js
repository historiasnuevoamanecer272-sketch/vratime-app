export function errorMessageKey(error) {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  if (/failed to fetch|fetch failed|network|timed?\s?out|timeout|offline|aborterror/.test(message)) return 'network';
  if (/jwt|unauthorized|not authenticated|session.*expir|refresh.token/.test(message)) return 'session';
  if (error?.code === '42501' || /row.level.security|permission.denied|not.authorized|forbidden/.test(message)) return 'permission';
  if (/quantity|insufficient.*(stock|available)|not.enough/.test(message)) return 'quantity';
  if (error?.code === '23505' || /duplicate.key|already.(booked|requested)|state.changed/.test(message)) return 'retryState';
  return 'save';
}

export const friendlyError = (error, t) => t(`reliabilityExperience.errors.${errorMessageKey(error)}`);
