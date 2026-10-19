const pickupWindowValue = (value) => (typeof value === 'string' ? value : value?.label || '');

export const pickupTimeForDisplay = (windows) => (Array.isArray(windows) ? windows.map(pickupWindowValue).filter(Boolean).join(' · ') : '');

export function pickupTimeForSave(value, originalWindows) {
  if (value === pickupTimeForDisplay(originalWindows)) return Array.isArray(originalWindows) ? originalWindows : [];
  return value.trim() ? [value.trim()] : [];
}

// The current category tree contains clothing, packaging and materials. Only
// clothing represents reusable items for which these condition choices fit.
export function shouldShowCondition(type, path = '') {
  return type === 'lend' || path === 'cloth/clothing' || path.startsWith('cloth/clothing/');
}

export function isWholeNumberInRange(value, maximum) {
  if (String(value).trim() === '') return false;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= maximum;
}

export function listingFormBlockers({ selected, form, photos, locationConfirmed }) {
  const blockers = [];
  if (!selected && form.type !== 'lend') blockers.push('category');
  if (!isWholeNumberInRange(form.quantity, 10000)) blockers.push('quantity');
  if (!locationConfirmed) blockers.push('location');
  if (form.type === 'lend') {
    const name = String(form.item_name || '').trim();
    const description = String(form.description || '').trim();
    if (name.length < 3 || name.length > 100) blockers.push('loanName');
    if (description.length < 5 || description.length > 500) blockers.push('loanDescription');
    if (!isWholeNumberInRange(form.loan_duration_days, 365)) blockers.push('loanDuration');
    if (!photos.length) blockers.push('loanPhoto');
  }
  return blockers;
}
