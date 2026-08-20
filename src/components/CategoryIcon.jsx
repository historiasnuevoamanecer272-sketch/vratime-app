import Icon from './Icon';
import glassIcon from '../assets/icons/icon-glass.png';
import clothIcon from '../assets/icons/icon-cloth.png';
import boxIcon from '../assets/icons/icon-box.png';
import palletIcon from '../assets/icons/icon-pallet.png';

const rootArt = {
  glass: glassIcon,
  cloth: clothIcon,
  box: boxIcon,
  pallet: palletIcon,
};

const iconForPath = (path) => {
  if (path.includes('/bottles')) return 'bottle';
  if (path.includes('/jars')) return 'jar';
  if (path.includes('/clothing')) return 'shirt';
  if (path.includes('/rags')) return 'fabric';
  if (path.includes('/office-paper')) return 'file';
  if (path.includes('/egg-crates')) return 'eggCarton';
  if (path.includes('/pallets')) return 'pallet';
  return 'box';
};

export default function CategoryIcon({ category, size = 28 }) {
  const path = category?.category_path || category?.path || '';
  const root = path.split('/')[0];
  const art = !path.includes('/') ? rootArt[root] : null;
  const tone = path.includes('green-') ? 'green' : path.includes('brown-') ? 'amber' : path.includes('clear-') ? 'aqua' : root;

  return (
    <span className={`category-symbol category-symbol-${tone}`} aria-hidden="true">
      {art ? <img className="category-art" src={art} alt="" /> : <Icon name={iconForPath(path)} size={size} strokeWidth={1.8} />}
    </span>
  );
}
