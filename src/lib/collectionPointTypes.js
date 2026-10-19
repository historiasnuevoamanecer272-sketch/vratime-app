export const COLLECTION_POINT_TYPES = Object.freeze([
  { key: 'glass', icon: 'glass', labels: { ru: 'Стекло', me: 'Staklo', en: 'Glass', fr: 'Verre', de: 'Glas' } },
  { key: 'paper', icon: 'box', labels: { ru: 'Бумага', me: 'Papir', en: 'Paper', fr: 'Papier', de: 'Papier' } },
  { key: 'textile', icon: 'shirt', labels: { ru: 'Текстиль', me: 'Tekstil', en: 'Textiles', fr: 'Textiles', de: 'Textilien' } },
  { key: 'packaging', icon: 'egg', labels: { ru: 'Упаковка', me: 'Ambalaza', en: 'Packaging', fr: 'Emballages', de: 'Verpackungen' } },
  { key: 'plastic', icon: 'recycle', labels: { ru: 'Пластик', me: 'Plastika', en: 'Plastic', fr: 'Plastique', de: 'Kunststoff' } },
  { key: 'metal', icon: 'can', labels: { ru: 'Металл', me: 'Metal', en: 'Metal', fr: 'Métal', de: 'Metall' } },
  { key: 'electronics', icon: 'monitor', labels: { ru: 'Электроника', me: 'Elektronika', en: 'Electronics', fr: 'Électronique', de: 'Elektrogeräte' } },
  { key: 'batteries', icon: 'battery', labels: { ru: 'Батарейки', me: 'Baterije', en: 'Batteries', fr: 'Piles', de: 'Batterien' } },
  { key: 'mixed', icon: 'leaf', labels: { ru: 'Разное', me: 'Razno', en: 'Mixed', fr: 'Divers', de: 'Sonstiges' } },
]);

export const collectionPointTypeKeys = COLLECTION_POINT_TYPES.map((type) => type.key);

export const collectionPointTypeLabel = (key, language = 'ru') => {
  const type = COLLECTION_POINT_TYPES.find((item) => item.key === key);
  return type?.labels?.[language] || type?.labels?.ru || key;
};
