import i18n, { resources, supportedLanguages } from '../src/i18n/index.js';
import { resolveProfileLanguage } from '../src/i18n/languages.js';

const expectedLanguages = ['ru', 'me', 'en', 'fr', 'de'];
if (JSON.stringify(supportedLanguages) !== JSON.stringify(expectedLanguages)) {
  throw new Error(`Expected supported languages ${expectedLanguages.join('/')}, got ${supportedLanguages.join('/')}`);
}

for (const language of expectedLanguages) {
  const initial = resolveProfileLanguage({ language: 'ru', preferred_language: 'ru' }, language, false);
  if (initial !== language) throw new Error(`New ${language} user lost the language selected before sign-in: ${initial}`);
}
for (const [profile, current, hasContacts, expected] of [
  [{ language: 'ru', preferred_language: 'de' }, 'fr', true, 'de'],
  [{ language: 'me' }, 'en', true, 'me'],
  [null, 'fr', false, 'fr'],
  [{ language: 'unsupported' }, 'de', true, 'de'],
  [null, 'unsupported', false, 'ru'],
]) {
  const actual = resolveProfileLanguage(profile, current, hasContacts);
  if (actual !== expected) throw new Error(`Profile language: expected ${expected}, got ${actual}`);
}

const flatten = (value, prefix = '', output = new Map()) => {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, path, output);
    else output.set(path, child);
  }
  return output;
};

const reference = flatten(resources.ru.translation);
for (const key of [
  'discovery.savedSearches', 'discovery.favourite', 'discovery.saveSearch', 'discovery.inbox',
  'points.title', 'points.unverified', 'points.verified', 'points.exists', 'points.missing', 'points.add',
  'lending.returnDue', 'lending.confirmHandover', 'lending.confirmReturn', 'lending.returned',
  'impact.title', 'impact.personalItems', 'impact.communityItems', 'impact.noCo2',
  'legal.eyebrow', 'legal.updatedAt', 'legal.back', 'legal.privacy.title', 'legal.offer.title',
  ...['controller', 'data', 'purpose', 'storage', 'contacts', 'retention', 'support', 'changes']
    .flatMap((section) => [`legal.privacy.sections.${section}.title`, `legal.privacy.sections.${section}.paragraphs`]),
  ...['platform', 'account', 'listings', 'prohibited', 'responsibility', 'termination', 'acceptance', 'support']
    .flatMap((section) => [`legal.offer.sections.${section}.title`, `legal.offer.sections.${section}.paragraphs`]),
]) {
  if (!reference.has(key)) throw new Error(`ru: missing required key ${key}`);
}
for (const language of expectedLanguages.filter((code) => code !== 'ru')) {
  const candidate = flatten(resources[language].translation);
  const missing = [...reference.keys()].filter((key) => !candidate.has(key));
  const extra = [...candidate.keys()].filter((key) => !reference.has(key));
  if (missing.length || extra.length) throw new Error(`${language}: missing=${missing.join(',')} extra=${extra.join(',')}`);
  for (const [key, value] of reference) {
    const translated = candidate.get(key);
    if (Array.isArray(value) && (!Array.isArray(translated) || translated.length !== value.length)) throw new Error(`${language}: array mismatch at ${key}`);
    const sourceStrings = Array.isArray(value) ? value : [value];
    const translatedStrings = Array.isArray(translated) ? translated : [translated];
    for (const [index, source] of sourceStrings.entries()) {
      const text = translatedStrings[index];
      if (typeof text !== 'string' || !text.trim()) throw new Error(`${language}: empty translation at ${key}.${index}`);
      const placeholders = (text) => [...text.matchAll(/\{\{\s*([\w]+)\s*\}\}/g)].map((match) => match[1]).sort().join(',');
      if (placeholders(source) !== placeholders(text)) throw new Error(`${language}: interpolation mismatch at ${key}.${index}`);
      if (key.startsWith('legal.')) {
        const tags = (text) => [...text.matchAll(/<[^>]+>/g)].map((match) => match[0]).join(',');
        if (tags(source) !== tags(text) || /<(?!\/?contact>)/.test(text)) throw new Error(`${language}: unsafe or mismatched legal tags at ${key}.${index}`);
      }
    }
  }
}

const pluralChecks = {
  ru: [[1, '1 объявление'], [2, '2 объявления'], [5, '5 объявлений']],
  me: [[1, '1 oglas'], [2, '2 oglasa'], [5, '5 oglasa']],
  en: [[1, '1 listing'], [2, '2 listings']],
  fr: [[0, '0 annonce'], [1, '1 annonce'], [2, '2 annonces']],
  de: [[0, '0 Anzeigen'], [1, '1 Anzeige'], [2, '2 Anzeigen']],
};
for (const [language, checks] of Object.entries(pluralChecks)) {
  await i18n.changeLanguage(language);
  for (const [count, expected] of checks) {
    const actual = i18n.t('map.offers', { count });
    if (actual !== expected) throw new Error(`${language}: expected "${expected}", got "${actual}"`);
  }
}

process.stdout.write(`i18n topology passed: ${reference.size} keys across ${expectedLanguages.join('/')}.\n`);
