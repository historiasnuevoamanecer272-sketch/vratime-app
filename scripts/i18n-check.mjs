import i18n, { resources } from '../src/i18n/index.js';

const flatten = (value, prefix = '', output = new Map()) => {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, path, output);
    else output.set(path, child);
  }
  return output;
};

const reference = flatten(resources.ru.translation);
for (const language of ['me', 'en']) {
  const candidate = flatten(resources[language].translation);
  const missing = [...reference.keys()].filter((key) => !candidate.has(key));
  const extra = [...candidate.keys()].filter((key) => !reference.has(key));
  if (missing.length || extra.length) throw new Error(`${language}: missing=${missing.join(',')} extra=${extra.join(',')}`);
  for (const [key, value] of reference) {
    const translated = candidate.get(key);
    if (Array.isArray(value) && (!Array.isArray(translated) || translated.length !== value.length)) throw new Error(`${language}: array mismatch at ${key}`);
    if (!Array.isArray(value) && (typeof translated !== 'string' || !translated.trim())) throw new Error(`${language}: empty translation at ${key}`);
  }
}

const pluralChecks = {
  ru: [[1, '1 объявление'], [2, '2 объявления'], [5, '5 объявлений']],
  me: [[1, '1 oglas'], [2, '2 oglasa'], [5, '5 oglasa']],
  en: [[1, '1 listing'], [2, '2 listings']],
};
for (const [language, checks] of Object.entries(pluralChecks)) {
  await i18n.changeLanguage(language);
  for (const [count, expected] of checks) {
    const actual = i18n.t('map.offers', { count });
    if (actual !== expected) throw new Error(`${language}: expected "${expected}", got "${actual}"`);
  }
}

process.stdout.write(`i18n topology passed: ${reference.size} keys across ru/me/en.\n`);
