import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { showToast } from '../lib/toast';

const iconAssets = import.meta.glob('../assets/icons/*.{png,PNG,jpg,jpeg,webp}', {
  eager: true,
  import: 'default',
});

const iconUrls = Object.fromEntries(
  Object.entries(iconAssets).map(([path, url]) => [path.split('/').pop(), url])
);

const CATEGORY_EMOJI_MAP = new Map([
  ['bottle', '🍾'],
  ['bottles', '🍾'],
  ['бутылка', '🍾'],
  ['бутылки', '🍾'],
  ['jar', '🫙'],
  ['jars', '🫙'],
  ['банка', '🫙'],
  ['банки', '🫙'],
  ['cardboard', '📦'],
  ['carton', '📦'],
  ['картон', '📦'],
  ['officepaper', '📄'],
  ['office-paper', '📄'],
  ['office_paper', '📄'],
  ['office', '📄'],
  ['paper', '📄'],
  ['бумага', '📄'],
  ['cloth', '👕'],
  ['clothes', '👕'],
  ['clothing', '👕'],
  ['одежда', '👕'],
  ['rags', '🧹'],
  ['rag', '🧹'],
  ['ветошь', '🧹'],
  ['pallet', '🧱'],
  ['pallets', '🧱'],
  ['поддон', '🧱'],
  ['поддоны', '🧱'],
  ['metal', '🥫'],
  ['металл', '🥫'],
  ['egg', '🥚'],
  ['eggs', '🥚'],
  ['eggcells', '🥚'],
  ['egg-cells', '🥚'],
  ['ячейки', '🥚'],
  ['яичныеячейки', '🥚'],
  ['clearbottle', '⚪'],
  ['clear-bottle', '⚪'],
  ['clearjar', '⚪'],
  ['clear-jar', '⚪'],
  ['transparentglass', '⚪'],
  ['прозрачноестекло', '⚪'],
  ['прозрачное-стекло', '⚪'],
  ['greenbottle', '🟢'],
  ['green-bottle', '🟢'],
  ['greenglass', '🟢'],
  ['green-glass', '🟢'],
  ['зеленоестекло', '🟢'],
  ['зеленое-стекло', '🟢'],
  ['brownbottle', '🟤'],
  ['brown-bottle', '🟤'],
  ['brown-glass', '🟤'],
  ['brownglass', '🟤'],
  ['коричневоестекло', '🟤'],
  ['коричневое-стекло', '🟤'],
  ['menscloth', '🧔'],
  ['mencloth', '🧔'],
  ['men-cloth', '🧔'],
  ['womencloth', '👩'],
  ['women-cloth', '👩'],
  ['kidscloth', '👶'],
  ['kids-cloth', '👶'],
  ['glass', '♻️'],
  ['textile', '👕'],
  ['textil', '👕'],
]);

const normalizeKey = (value = '') =>
  value
    .toString()
    .toLowerCase()
    .trim()
    .replaceAll('ё', 'е')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\u0400-\u04ff-]/g, '')
    .replace(/-+/g, '-');

const getPathSegment = (value = '') => {
  const rawValue = value.toString().trim().replaceAll('ё', 'е');
  const segment = rawValue.split('/').filter(Boolean).at(-1) || rawValue;
  return normalizeKey(segment);
};

const getIconUrl = (name) => iconUrls[name] || null;
const LISTING_PHOTOS_BUCKET = 'LISTING-PHOTOS';

function LocationSelector({ position, setPosition }) {
  useMapEvents({
    click(e) {
      setPosition([e.latlng.lat, e.latlng.lng]);
    },
  });

  return <Marker position={position} />;
}

export default function CreateListing({ onBack, onSuccess }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [imageName, setImageName] = useState('');
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState('');
  const [position, setPosition] = useState([42.441, 19.263]);
  const [categories, setCategories] = useState([]);
  const [categoryTrail, setCategoryTrail] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedCategoryLabel, setSelectedCategoryLabel] = useState('');
  const [selectedCategoryPath, setSelectedCategoryPath] = useState('');
  const [formData, setFormData] = useState({
    type: 'give',
    quantity: 1,
  });

  useEffect(() => {
    let active = true;

    const fetchCategories = async () => {
      setCategoriesLoading(true);
      setCategoriesError('');

      const { data, error } = await supabase
        .from('categories')
        .select('id, name, parent_id, icon_url, category_path')
        .order('name', { ascending: true });

      if (!active) return;

      if (error) {
        console.error('Ошибка загрузки:', error);
        setCategories([]);
        setCategoriesError(error.message);
        showToast('Не удалось загрузить категории: ' + error.message, 'error');
      } else {
        setCategories(data || []);
      }

      setCategoriesLoading(false);
    };

    fetchCategories();

    return () => {
      active = false;
    };
  }, []);

  const currentParentCategory = categoryTrail.at(-1) || null;

  const visibleCategories = useMemo(() => {
    const parentId = currentParentCategory?.id ?? null;
    return categories.filter((category) => {
      if (parentId === null) return category.parent_id === null;
      return category.parent_id === parentId;
    });
  }, [categories, currentParentCategory]);

  const breadcrumbLabel = categoryTrail.length > 0 ? categoryTrail.map((item) => item.name).join(' > ') : 'Основные категории';

  const getCategoryAsset = (category) => {
    const iconName = category.icon_url?.split('/').pop();
    if (!iconName) return null;
    return getIconUrl(iconName);
  };

  const getCategoryEmoji = (category) => {
    const values = [category.category_path, category.name].filter(Boolean);
    const keys = values.flatMap((value) => value.toString().split('/').map(getPathSegment)).filter(Boolean);

    for (const key of keys) {
      if (CATEGORY_EMOJI_MAP.has(key)) return CATEGORY_EMOJI_MAP.get(key);
    }

    return '📦';
  };

  const getFinalPath = (trail) => {
    const leaf = trail.at(-1);
    if (!leaf) return '';

    if (leaf.category_path?.includes('/')) {
      return leaf.category_path;
    }

    return trail
      .map((item) => getPathSegment(item.category_path || item.name))
      .filter(Boolean)
      .join('/');
  };

  const openCategory = (category) => {
    const children = categories.filter((item) => item.parent_id === category.id);

    if (children.length > 0) {
      setCategoryTrail((current) => [...current, category]);
      return;
    }

    const finalTrail = [...categoryTrail, category];
    setSelectedCategoryId(category.id);
    setSelectedCategoryLabel(category.name);
    setSelectedCategoryPath(getFinalPath(finalTrail));
    setStep(3);
  };

  const jumpToCrumb = (index) => {
    setCategoryTrail(categoryTrail.slice(0, index + 1));
  };

  const handleStepBack = () => {
    if (step === 3) {
      setStep(2);
      return;
    }

    if (step === 2 && categoryTrail.length > 0) {
      setCategoryTrail(categoryTrail.slice(0, -1));
      return;
    }

    if (step > 1) {
      setStep(step - 1);
      setCategoryTrail([]);
      return;
    }

    onBack();
  };

  const handlePublish = async () => {
    setLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error } = await supabase.from('listings').insert({
        user_id: user.id,
        type: formData.type,
        status: 'active',
        category_id: selectedCategoryId,
        category: selectedCategoryLabel,
        category_path: selectedCategoryPath,
        image_url: imageUrl || null,
        quantity: formData.quantity,
        lat: position[0],
        lng: position[1],
      });

      if (error) throw error;
      window.dispatchEvent(new Event('listings-updated'));
      onSuccess();
    } catch (e) {
      showToast('Ошибка публикации: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoSelect = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setPhotoUploading(true);

    try {
      const filePath = `listings/${Date.now()}_${file.name}`;
      console.log('Попытка загрузки в бакет:', LISTING_PHOTOS_BUCKET);
      const { error: uploadError } = await supabase.storage
        .from(LISTING_PHOTOS_BUCKET)
        .upload(filePath, file, {
          upsert: true,
          contentType: file.type,
        });

      if (uploadError) {
        console.error('Детали ошибки Storage:', uploadError);
        throw uploadError;
      }

      const { data } = supabase.storage.from(LISTING_PHOTOS_BUCKET).getPublicUrl(filePath);
      const publicUrl = data?.publicUrl || '';

      if (!publicUrl) {
        throw new Error('Не удалось получить public URL файла');
      }

      setImageUrl(publicUrl);
      setImageName(file.name);
    } catch (error) {
      console.error('Детали ошибки Storage:', error);
      console.error('Ошибка загрузки фото:', error);
      showToast('Не удалось загрузить фото: ' + error.message, 'error');
    } finally {
      setPhotoUploading(false);
      event.target.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-[2000] flex flex-col overflow-hidden bg-white p-6">
      <div className="mb-6 mt-4 flex items-center justify-between">
        <button onClick={handleStepBack} className="font-medium text-gray-500">
          ← Назад
        </button>
        <h2 className="text-xl font-bold">
          {step === 2 ? `Шаг 2 из 3` : `Шаг ${step} из 3`}
        </h2>
        <div className="w-16" />
      </div>

      {step === 1 && (
        <div className="mt-6 flex flex-col gap-4">
          <h3 className="mb-4 text-center text-lg font-medium">Что вы хотите сделать?</h3>
          <button
            onClick={() => {
              setFormData({ ...formData, type: 'give' });
              setStep(2);
            }}
            className="rounded-2xl border-2 border-green-500 bg-green-50 p-6 text-left transition hover:bg-green-100"
          >
            <span className="mb-2 block text-3xl">🎁</span>
            <span className="text-lg font-bold text-green-700">Я ОТДАЮ</span>
            <p className="mt-1 text-sm text-green-600">У меня есть сырье для переработки</p>
          </button>
          <button
            onClick={() => {
              setFormData({ ...formData, type: 'take' });
              setStep(2);
            }}
            className="mt-2 rounded-2xl border-2 border-blue-500 bg-blue-50 p-6 text-left transition hover:bg-blue-100"
          >
            <span className="mb-2 block text-3xl">🚚</span>
            <span className="text-lg font-bold text-blue-700">Я ЗАБЕРУ</span>
            <p className="mt-1 text-sm text-blue-600">Мне нужна тара или материалы</p>
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-24">
          <div className="space-y-3">
            <h3 className="text-center text-lg font-medium">Что именно и сколько?</h3>
            <p className="text-center text-sm font-medium text-emerald-700">{breadcrumbLabel}</p>
            <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-gray-500">
              {categoryTrail.length === 0 ? (
                <span className="rounded-full bg-gray-100 px-3 py-1 font-medium text-gray-700">Основные категории</span>
              ) : (
                categoryTrail.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => jumpToCrumb(index)}
                    className={`rounded-full px-3 py-1 font-medium transition ${
                      index === categoryTrail.length - 1
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {item.name}
                  </button>
                ))
              )}
            </div>
            <p className="text-center text-sm text-gray-500">
              {categoryTrail.length === 0
                ? 'Сначала выберите основную категорию'
                : 'Вы можете вернуться на любой уровень через хлебные крошки'}
            </p>
          </div>

          {categoriesLoading ? (
            <div className="py-16 text-center text-sm text-gray-500">Загружаем категории...</div>
          ) : visibleCategories.length > 0 ? (
            <div className="grid grid-cols-2 gap-4">
              {visibleCategories.map((cat) => {
                const iconSrc = getCategoryAsset(cat);
                const emoji = getCategoryEmoji(cat);
                const isSelectedBranch = categoryTrail.some((item) => item.id === cat.id);

                return (
                  <button
                    key={cat.id}
                    onClick={() => openCategory(cat)}
                    className={`flex min-h-[132px] flex-col items-center justify-center gap-3 rounded-2xl border-2 bg-white p-4 text-left transition hover:border-emerald-500 hover:bg-emerald-50 ${
                      isSelectedBranch ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-50">
                      {iconSrc ? (
                        <img src={iconSrc} alt="" className="h-12 w-12 object-contain" />
                      ) : (
                        <span className="text-4xl leading-none">{emoji}</span>
                      )}
                    </div>
                    <span className="text-center text-sm font-medium">{cat.name}</span>
                    {categories.some((item) => item.parent_id === cat.id) ? (
                      <span className="text-xs font-medium text-emerald-600">Открыть подкатегории</span>
                    ) : (
                      <span className="text-xs font-medium text-gray-400">Финальная категория</span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2 py-12 text-center">
              <p className="text-sm text-gray-500">
                {categoryTrail.length === 0
                  ? 'Категории пока не найдены.'
                  : 'В этой ветке пока нет подкатегорий.'}
              </p>
              {categoriesError ? <p className="text-xs text-rose-500">{categoriesError}</p> : null}
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-28">
          <h3 className="text-center text-lg font-medium">Где находится сырье?</h3>
          <p className="text-center text-sm text-gray-500">Нажми на карту, чтобы сдвинуть маркер</p>

          <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-emerald-800">Фото лота</p>
                <p className="text-xs text-emerald-700">Необязательно. Если фото не выбрать, останется стандартная иконка.</p>
              </div>
              <label className="cursor-pointer rounded-xl bg-white px-4 py-2 text-sm font-bold text-emerald-700 shadow-sm transition hover:bg-emerald-100">
                {photoUploading ? 'Загружаем...' : 'Выбрать фото'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoSelect}
                  disabled={photoUploading}
                />
              </label>
            </div>

            {imageUrl ? (
              <div className="mt-4 flex items-center gap-3 rounded-xl bg-white p-3">
                <img src={imageUrl} alt={imageName || 'Фото лота'} className="h-16 w-16 rounded-lg object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{imageName || 'Фото загружено'}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setImageUrl('');
                      setImageName('');
                    }}
                    className="mt-1 text-xs font-semibold text-rose-600"
                  >
                    Удалить фото
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="z-0 h-80 flex-shrink-0 overflow-hidden rounded-xl border-2 border-gray-200 sm:h-96">
            <MapContainer center={position} zoom={13} zoomControl={false} className="h-full w-full">
              <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
              <LocationSelector position={position} setPosition={setPosition} />
            </MapContainer>
          </div>

          <button
            disabled={loading}
            onClick={handlePublish}
            className="rounded-xl bg-green-600 py-4 font-bold text-white shadow-lg transition hover:bg-green-700 disabled:opacity-50"
          >
            {loading
              ? 'Секунду...'
              : formData.type === 'give'
                ? 'Опубликовать лот'
                : 'Разместить запрос на вывоз'}
          </button>
        </div>
      )}
    </div>
  );
}
