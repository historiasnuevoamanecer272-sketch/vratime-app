import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { showToast } from '../lib/toast';
import Icon from '../components/Icon';

const iconAssets = import.meta.glob('../assets/icons/*.{png,PNG,jpg,jpeg,webp}', {
  eager: true,
  import: 'default',
});

const iconUrls = Object.fromEntries(
  Object.entries(iconAssets).map(([path, url]) => [path.split('/').pop(), url])
);

const getPinUrl = (name) => new URL(`../assets/pins/${name}`, import.meta.url).href;
const locationIcon = new L.Icon({
  iconUrl: getPinUrl('pin-give.png'),
  iconSize: [40, 48],
  iconAnchor: [20, 48],
});

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

  return <Marker position={position} icon={locationIcon} />;
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
        console.error('Ошибка загрузки категорий:', error);
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

  const breadcrumbLabel = categoryTrail.length > 0 ? categoryTrail.map((item) => item.name).join(' / ') : 'Основные категории';

  const getCategoryAsset = (category) => {
    const iconName = category.icon_url?.split('/').pop();
    if (!iconName) return null;
    return getIconUrl(iconName);
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
      const { error: uploadError } = await supabase.storage
        .from(LISTING_PHOTOS_BUCKET)
        .upload(filePath, file, {
          upsert: true,
          contentType: file.type,
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from(LISTING_PHOTOS_BUCKET).getPublicUrl(filePath);
      const publicUrl = data?.publicUrl || '';

      if (!publicUrl) {
        throw new Error('Не удалось получить public URL файла');
      }

      setImageUrl(publicUrl);
      setImageName(file.name);
    } catch (error) {
      console.error('Ошибка загрузки фото:', error);
      showToast('Не удалось загрузить фото: ' + error.message, 'error');
    } finally {
      setPhotoUploading(false);
      event.target.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-[7000] bg-slate-950/40">
      <div className="app-container flex h-[100svh] flex-col overflow-hidden bg-[#f6faf4] shadow-[0_0_80px_rgba(15,23,42,0.28)]">
        <header className="glass-panel rounded-b-[28px] px-5 pb-4 pt-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <button type="button" onClick={handleStepBack} className="btn-ghost h-11 min-h-11 px-3 text-sm">
              <Icon name="arrowLeft" size={18} />
              Назад
            </button>
            <div className="text-right">
              <p className="section-title">Новый лот</p>
              <p className="text-sm font-black text-gray-950">Шаг {step} из 3</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className={`h-2 rounded-full ${item <= step ? 'bg-emerald-500' : 'bg-emerald-100'}`}
              />
            ))}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {step === 1 && (
            <section className="space-y-4">
              <div>
                <p className="section-title">Тип объявления</p>
                <h2 className="mt-2 text-3xl font-black tracking-tight text-gray-950">Что хотите сделать?</h2>
              </div>

              <button
                type="button"
                onClick={() => {
                  setFormData({ ...formData, type: 'give' });
                  setStep(2);
                }}
                className="soft-card flex w-full items-center gap-4 p-5 text-left transition hover:border-emerald-300 hover:bg-emerald-50"
              >
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                  <Icon name="gift" size={30} />
                </span>
                <span>
                  <span className="block text-xl font-black text-gray-950">Я отдаю</span>
                  <span className="mt-1 block text-sm font-medium leading-5 text-gray-600">
                    У меня есть тара или материалы для переработки.
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setFormData({ ...formData, type: 'take' });
                  setStep(2);
                }}
                className="soft-card flex w-full items-center gap-4 p-5 text-left transition hover:border-sky-300 hover:bg-sky-50"
              >
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                  <Icon name="truck" size={32} />
                </span>
                <span>
                  <span className="block text-xl font-black text-gray-950">Я заберу</span>
                  <span className="mt-1 block text-sm font-medium leading-5 text-gray-600">
                    Мне нужна тара, сырьё или материалы для проекта.
                  </span>
                </span>
              </button>
            </section>
          )}

          {step === 2 && (
            <section className="space-y-5 pb-10">
              <div>
                <p className="section-title">Категория</p>
                <h2 className="mt-2 text-3xl font-black tracking-tight text-gray-950">Что именно?</h2>
                <p className="mt-2 text-sm font-bold text-emerald-700">{breadcrumbLabel}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {categoryTrail.length === 0 ? (
                  <span className="chip chip-active">Основные категории</span>
                ) : (
                  categoryTrail.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => jumpToCrumb(index)}
                      className={`chip ${index === categoryTrail.length - 1 ? 'chip-active' : ''}`}
                    >
                      {item.name}
                    </button>
                  ))
                )}
              </div>

              {categoriesLoading ? (
                <div className="card py-14 text-center text-sm font-bold text-gray-500">Загружаем категории...</div>
              ) : visibleCategories.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {visibleCategories.map((cat) => {
                    const iconSrc = getCategoryAsset(cat);
                    const isSelectedBranch = categoryTrail.some((item) => item.id === cat.id);
                    const hasChildren = categories.some((item) => item.parent_id === cat.id);

                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => openCategory(cat)}
                        className={`soft-card flex min-h-[146px] flex-col items-center justify-center gap-3 p-4 text-center transition hover:border-emerald-400 hover:bg-emerald-50 ${
                          isSelectedBranch ? 'border-emerald-400 bg-emerald-50' : ''
                        }`}
                      >
                        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-50 text-emerald-700">
                          {iconSrc ? <img src={iconSrc} alt="" className="h-12 w-12 object-contain" /> : <Icon name="box" size={34} />}
                        </span>
                        <span className="text-sm font-black leading-5 text-gray-950">{cat.name}</span>
                        <span className="text-xs font-bold text-gray-400">
                          {hasChildren ? 'Открыть подкатегории' : 'Выбрать'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="card p-6 text-center">
                  <Icon name="empty" size={44} className="mx-auto text-gray-300" />
                  <p className="mt-3 text-sm font-bold text-gray-500">
                    {categoryTrail.length === 0
                      ? 'Категории пока не найдены.'
                      : 'В этой ветке пока нет подкатегорий.'}
                  </p>
                  {categoriesError ? <p className="mt-2 text-xs text-rose-500">{categoriesError}</p> : null}
                </div>
              )}
            </section>
          )}

          {step === 3 && (
            <section className="space-y-4 pb-32">
              <div>
                <p className="section-title">Публикация</p>
                <h2 className="mt-2 text-3xl font-black tracking-tight text-gray-950">Где находится сырьё?</h2>
                <p className="mt-2 text-sm font-medium leading-6 text-gray-600">
                  Нажмите на карту, чтобы поставить точку. Фото необязательно, но помогает быстрее договориться.
                </p>
              </div>

              <div className="card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                      <Icon name="camera" size={24} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-black text-gray-950">Фото лота</p>
                      <p className="truncate text-sm font-medium text-gray-500">{imageName || 'Можно пропустить'}</p>
                    </div>
                  </div>
                  <label className="btn-secondary h-11 min-h-11 cursor-pointer px-4 text-sm">
                    {photoUploading ? 'Загрузка...' : 'Выбрать'}
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
                  <div className="mt-4 flex items-center gap-3 rounded-2xl bg-emerald-50 p-3">
                    <img src={imageUrl} alt={imageName || 'Фото лота'} className="h-16 w-16 rounded-xl object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-gray-900">{imageName || 'Фото загружено'}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setImageUrl('');
                          setImageName('');
                        }}
                        className="mt-1 text-xs font-black text-rose-600"
                      >
                        Удалить фото
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <label className="block space-y-2">
                <span className="text-sm font-bold text-gray-700">Количество</span>
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  enterKeyHint="done"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: Number(e.target.value) || 1 })}
                  className="field"
                />
              </label>

              <div className="h-80 overflow-hidden rounded-[24px] border border-emerald-100 shadow-sm sm:h-96">
                <MapContainer center={position} zoom={13} zoomControl={false} className="h-full w-full">
                  <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
                  <LocationSelector position={position} setPosition={setPosition} />
                </MapContainer>
              </div>
            </section>
          )}
        </main>

        {step === 3 && (
          <footer className="glass-panel fixed bottom-0 left-1/2 z-[7100] w-full max-w-[520px] -translate-x-1/2 rounded-t-[28px] px-5 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-4">
            <button disabled={loading} onClick={handlePublish} className="btn-primary w-full">
              <Icon name={formData.type === 'give' ? 'gift' : 'truck'} size={20} />
              {loading
                ? 'Секунду...'
                : formData.type === 'give'
                  ? 'Опубликовать лот'
                  : 'Разместить запрос на вывоз'}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
