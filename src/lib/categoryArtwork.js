import categoryGlass from '../assets/visuals/v1/category-glass-v1.webp';
import categoryTextile from '../assets/visuals/v1/category-textile-v1.webp';
import categoryPaper from '../assets/visuals/v1/category-paper-v1.webp';
import categoryPackaging from '../assets/visuals/v1/category-packaging-v1.webp';
import categoryPallet from '../assets/visuals/v1/category-pallet-v1.webp';

const artworkByPath = {
  glass: categoryGlass,
  cloth: categoryTextile,
  box: categoryPaper,
  pallet: categoryPackaging,
  'pallet/pallets': categoryPallet,
};

export const getCategoryArtwork = (category) => artworkByPath[category?.category_path || category?.path || ''] || null;
