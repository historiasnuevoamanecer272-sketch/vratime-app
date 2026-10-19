import { categoryLabel, listingCategoryLabel, categorySearchText, normalizeSearch } from '../src/lib/categories.js';
import { collectionPointTypeLabel } from '../src/lib/collectionPointTypes.js';

const categories = [
  { category_path: 'glass', translations: { ru: 'Стекло', me: 'Staklo', en: 'Glass' } },
  { category_path: 'glass/jars', translations: { ru: 'Банки', me: 'Tegle', en: 'Jars' } },
  { category_path: 'glass/jars/clear-jar', translations: { ru: 'Прозрачные банки', me: 'Prozirne tegle', en: 'Clear jars' } },
];
const listing = { category_path: 'glass/jars/clear-jar', category: 'Прозрачные банки', description: '' };
const text = categorySearchText(listing, categories);

for (const query of ['стекло', 'стекло', 'банки', 'staklo', 'tegle', 'glass', 'jars', 'clear jar', 'verre', 'bocaux', 'glas', 'glaser']) {
  if (!text.includes(normalizeSearch(query))) throw new Error(`Category search missed: ${query}`);
}

for (const [language, rootLabel, itemLabel, pointLabel] of [
  ['fr', 'Verre', 'Bocaux transparents', 'Piles'],
  ['de', 'Glas', 'Klare Gläser', 'Batterien'],
]) {
  if (categoryLabel(categories[0], language) !== rootLabel) throw new Error(`Missing ${language} category label`);
  if (listingCategoryLabel(listing, language) !== itemLabel) throw new Error(`Missing ${language} listing category label`);
  if (collectionPointTypeLabel('batteries', language) !== pointLabel) throw new Error(`Missing ${language} collection material label`);
}

process.stdout.write('Category hierarchy search passed across ru/me/en/fr/de.\n');
