export const COLLECTION_POINT_TYPES = Object.freeze([
  { key: 'glass', icon: 'glass', labels: { ru: 'Стекло', me: 'Staklo', en: 'Glass' } },
  { key: 'paper', icon: 'box', labels: { ru: 'Бумага', me: 'Papir', en: 'Paper' } },
  { key: 'textile', icon: 'shirt', labels: { ru: 'Текстиль', me: 'Tekstil', en: 'Textiles' } },
  { key: 'packaging', icon: 'egg', labels: { ru: 'Упаковка', me: 'Ambalaza', en: 'Packaging' } },
  { key: 'plastic', icon: 'recycle', labels: { ru: 'Пластик', me: 'Plastika', en: 'Plastic' } },
  { key: 'metal', icon: 'can', labels: { ru: 'Металл', me: 'Metal', en: 'Metal' } },
  { key: 'electronics', icon: 'monitor', labels: { ru: 'Электроника', me: 'Elektronika', en: 'Electronics' } },
  { key: 'batteries', icon: 'battery', labels: { ru: 'Батарейки', me: 'Baterije', en: 'Batteries' } },
  { key: 'mixed', icon: 'leaf', labels: { ru: 'Разное', me: 'Razno', en: 'Mixed' } },
]);

export const collectionPointTypeKeys = COLLECTION_POINT_TYPES.map((type) => type.key);

export const collectionPointTypeLabel = (key, language = 'ru') => {
  const type = COLLECTION_POINT_TYPES.find((item) => item.key === key);
  return type?.labels?.[language] || type?.labels?.ru || key;
};
