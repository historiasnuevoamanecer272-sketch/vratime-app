export const languageOptions = Object.freeze([
  { id: 'ru', label: 'RU', name: 'Русский' },
  { id: 'me', label: 'ME', name: 'Crnogorski' },
  { id: 'en', label: 'EN', name: 'English' },
  { id: 'fr', label: 'FR', name: 'Français' },
  { id: 'de', label: 'DE', name: 'Deutsch' },
]);

export const supportedLanguages = languageOptions.map(({ id }) => id);

export const normalizeAppLanguage = (value) => {
  const code = typeof value === 'string' ? value.trim().toLowerCase().split(/[-_]/)[0] : '';
  if (['sr', 'cnr', 'bs', 'hr'].includes(code)) return 'me';
  return supportedLanguages.includes(code) ? code : null;
};

export const resolveInitialLanguage = (storedLanguage, browserLanguages = [], browserLanguage) => {
  const savedLanguage = normalizeAppLanguage(storedLanguage);
  if (savedLanguage) return savedLanguage;
  const deviceLanguages = Array.isArray(browserLanguages) ? browserLanguages : [];
  for (const language of [...deviceLanguages, browserLanguage]) {
    const supportedLanguage = normalizeAppLanguage(language);
    if (supportedLanguage) return supportedLanguage;
  }
  return 'ru';
};

export const resolveProfileLanguage = (profile, currentLanguage, hasContacts) => {
  const savedLanguage = profile?.preferred_language || profile?.language;
  // An unfinished profile can still contain the database's default Russian.
  // Preserve the language chosen before sign-in until onboarding is saved.
  if (hasContacts && supportedLanguages.includes(savedLanguage)) return savedLanguage;
  return supportedLanguages.includes(currentLanguage) ? currentLanguage : 'ru';
};
