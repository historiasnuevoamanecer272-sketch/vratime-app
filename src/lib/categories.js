const legacyTranslations = {
  glass: { ru: 'Стекло', me: 'Staklo', en: 'Glass' },
  cloth: { ru: 'Текстиль', me: 'Tekstil', en: 'Textiles' },
  box: { ru: 'Бумага', me: 'Papir', en: 'Paper' },
  pallet: { ru: 'Упаковка', me: 'Ambalaža', en: 'Packaging' },
  'glass/bottles': { ru: 'Бутылки', me: 'Boce', en: 'Bottles' },
  'glass/jars': { ru: 'Банки', me: 'Tegle', en: 'Jars' },
  'cloth/clothing': { ru: 'Одежда', me: 'Odjeća', en: 'Clothing' },
  'cloth/rags': { ru: 'Ветошь', me: 'Krpe', en: 'Rags' },
  'box/cardboard': { ru: 'Картон', me: 'Karton', en: 'Cardboard' },
  'box/office-paper': { ru: 'Офисная бумага', me: 'Kancelarijski papir', en: 'Office paper' },
  'pallet/egg-crates': { ru: 'Яичные ячейки', me: 'Kartoni za jaja', en: 'Egg cartons' },
  'pallet/pallets': { ru: 'Поддоны', me: 'Palete', en: 'Pallets' },
  'glass/bottles/clear-bottle': { ru: 'Прозрачные бутылки', me: 'Prozirne boce', en: 'Clear bottles' },
  'glass/bottles/green-bottle': { ru: 'Зелёные бутылки', me: 'Zelene boce', en: 'Green bottles' },
  'glass/bottles/brown-bottle': { ru: 'Коричневые бутылки', me: 'Braon boce', en: 'Brown bottles' },
  'glass/jars/clear-jar': { ru: 'Прозрачные банки', me: 'Prozirne tegle', en: 'Clear jars' },
  'glass/jars/colored-jar': { ru: 'Цветные банки', me: 'Obojene tegle', en: 'Colored jars' },
  'cloth/clothing/men-cloth': { ru: 'Мужская одежда', me: 'Muška odjeća', en: "Men's clothing" },
  'cloth/clothing/women-cloth': { ru: 'Женская одежда', me: 'Ženska odjeća', en: "Women's clothing" },
  'cloth/clothing/kids-cloth': { ru: 'Детская одежда', me: 'Dječja odjeća', en: "Children's clothing" },
};

export const categoryLabel = (category, language = 'ru') => {
  if (!category) return '';
  const path = category.category_path || category.path || '';
  const translations = category.translations || legacyTranslations[path];
  return translations?.[language] || translations?.ru || category.name || category.category || path;
};

export const listingCategoryLabel = (listing, language = 'ru') => {
  const path = listing?.category_path || '';
  return legacyTranslations[path]?.[language] || listing?.category || path;
};

export const rootPath = (category) => (category?.category_path || '').split('/')[0];

export const normalizeSearch = (value) => String(value || '')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .replace(/ё/g, 'е')
  .toLowerCase()
  .trim();

export const categorySearchText = (listing, categories = []) => {
  const path = listing?.category_path || '';
  const parts = path.split('/').filter(Boolean);
  const paths = parts.map((_, index) => parts.slice(0, index + 1).join('/'));
  const values = [listing?.category, listing?.description, path.replace(/[/-]/g, ' ')];

  paths.forEach((currentPath) => {
    const category = categories.find((item) => (item.category_path || item.path) === currentPath);
    const translations = category?.translations || legacyTranslations[currentPath];
    if (translations) values.push(...Object.values(translations));
    values.push(category?.name, category?.category, currentPath.replace(/[/-]/g, ' '));
  });

  return normalizeSearch(values.filter(Boolean).join(' '));
};
