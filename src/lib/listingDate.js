export function formatListingDate(value, language) {
  if (value == null || value === '') return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(language === 'me' ? 'sr-Latn-ME' : language, { day:'numeric', month:'short' }).format(date);
}
