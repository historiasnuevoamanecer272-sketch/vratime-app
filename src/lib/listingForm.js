import { imageErrorKey } from './imagePreparation.js';

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

export function listingSubmissionErrorKey(failure) {
  if (failure?.code === 'form_auth_changed' || failure?.message === 'media_auth_changed') return 'mediaExperience.errors.authChanged';
  if (failure?.code === 'listing_publication_conflict') return 'draftExperience.publicationConflict';
  if (/^(22|23)/.test(String(failure?.code || '')) || failure?.code === 'P0001') return 'createExperience.invalidFields';
  if (['unsupported', 'inputTooLarge', 'decode', 'outputTooLarge', 'unavailable'].includes(failure?.code) || String(failure?.message || '').startsWith('media_')) return imageErrorKey(failure);
  return 'draftExperience.saveError';
}

export function listingFormBlockers({ selected, form, photos, locationConfirmed }) {
  const blockers = [];
  if (!selected && form.type !== 'lend') blockers.push('category');
  if (!isWholeNumberInRange(form.quantity, 10000)) blockers.push('quantity');
  const weight = String(form.weight_kg ?? '').trim();
  // numeric(8,2) rounds before checking positivity and its six-digit integer limit.
  if (weight && (!Number.isFinite(Number(weight)) || Number(weight) < 0.005 || Number(weight) >= 999999.995)) blockers.push('weight');
  if (!locationConfirmed) blockers.push('location');
  if (form.type === 'lend') {
    const name = String(form.item_name || '').trim();
    const description = String(form.description || '').trim();
    if ([...name].length < 3 || [...name].length > 100) blockers.push('loanName');
    if ([...description].length < 5 || [...description].length > 500) blockers.push('loanDescription');
    if (!isWholeNumberInRange(form.loan_duration_days, 365)) blockers.push('loanDuration');
    if (!photos.length) blockers.push('loanPhoto');
  }
  return blockers;
}
