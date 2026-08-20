import { categorySearchText, normalizeSearch } from '../src/lib/categories.js';

const categories = [
  { category_path: 'glass', translations: { ru: 'Стекло', me: 'Staklo', en: 'Glass' } },
  { category_path: 'glass/jars', translations: { ru: 'Банки', me: 'Tegle', en: 'Jars' } },
  { category_path: 'glass/jars/clear-jar', translations: { ru: 'Прозрачные банки', me: 'Prozirne tegle', en: 'Clear jars' } },
];
const listing = { category_path: 'glass/jars/clear-jar', category: 'Прозрачные банки', description: '' };
const text = categorySearchText(listing, categories);

for (const query of ['стекло', 'стекло', 'банки', 'staklo', 'tegle', 'glass', 'jars', 'clear jar']) {
  if (!text.includes(normalizeSearch(query))) throw new Error(`Category search missed: ${query}`);
}

process.stdout.write('Category hierarchy search passed across ru/me/en.\n');
