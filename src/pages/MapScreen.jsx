import { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { supabase } from '../supabaseClient';
import CreateListing from './CreateListing';
import emptyImg from '../assets/images/ill-empty.png';
import { showToast } from '../lib/toast';
import Icon from '../components/Icon';

const getIconUrl = (name) => new URL(`../assets/icons/${name}`, import.meta.url).href;
const getPinUrl = (name) => new URL(`../assets/pins/${name}`, import.meta.url).href;
const normalizeKey = (value = '') =>
  value
    .toString()
    .toLowerCase()
    .trim()
    .replaceAll('ё', 'е')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\u0400-\u04ff-]/g, '')
    .replace(/-+/g, '-');

const MAIN_CATEGORY_ALIASES = [
  ['glass', 'стекло'],
  ['textile', 'textil', 'cloth', 'текстиль'],
  ['paper', 'бумага'],
  ['packaging', 'упаковка', 'cardboard', 'carton'],
];

const distanceOptions = [
  { id: 'all', label: 'Любое расстояние' },
  { id: '1', label: 'До 1 км' },
  { id: '5', label: 'До 5 км' },
  { id: '10', label: 'До 10 км' },
];

const giveIcon = new L.Icon({
  iconUrl: getPinUrl('pin-give.png'),
  iconSize: [40, 48],
  iconAnchor: [20, 48],
  popupAnchor: [0, -45],
});

const takeIcon = new L.Icon({
  iconUrl: getPinUrl('pin-take.png'),
  iconSize: [40, 48],
  iconAnchor: [20, 48],
  popupAnchor: [0, -45],
});

export default function MapScreen() {
  const [isCreating, setIsCreating] = useState(false);
  const [listings, setListings] = useState([]);
  const [categories, setCategories] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [activeCategory, setActiveCategory] = useState(null);
  const [distanceFilter, setDistanceFilter] = useState('all');
  const [userLocation, setUserLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const defaultPosition = [42.441, 19.263];

  useEffect(() => {
    fetchListings();
    fetchCategories();

    const handleListingsUpdated = () => fetchListings();
    window.addEventListener('listings-updated', handleListingsUpdated);

    return () => {
      window.removeEventListener('listings-updated', handleListingsUpdated);
    };
  }, []);

  async function fetchListings() {
    const { data: userData } = await supabase.auth.getUser();
    setCurrentUserId(userData?.user?.id || null);

    const { data, error } = await supabase
      .from('listings')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Ошибка загрузки лотов для карты:', error);
      return;
    }

    setListings(data || []);
  }

  async function fetchCategories() {
    const { data, error } = await supabase
      .from('categories')
      .select('id, name, parent_id, category_path, icon_url')
      .order('name', { ascending: true });

    if (!error) setCategories(data || []);
  }

  const mainCategoryChips = useMemo(() => {
    const rootCategories = categories.filter((category) => category.parent_id === null);
    const chips = [];
    const usedIds = new Set();

    MAIN_CATEGORY_ALIASES.forEach((aliases) => {
      const found = rootCategories.find((category) => {
        const categoryKey = normalizeKey(category.category_path?.split('/')?.[0] || category.name);
        return aliases.some((alias) => categoryKey.startsWith(normalizeKey(alias)));
      });

      if (found && !usedIds.has(found.id)) {
        chips.push(found);
        usedIds.add(found.id);
      }
    });

    rootCategories.forEach((category) => {
      if (chips.length >= 4) return;
      if (!usedIds.has(category.id)) {
        chips.push(category);
        usedIds.add(category.id);
      }
    });

    return chips.slice(0, 4);
  }, [categories]);

  const getListingPath = (item) => item.category_path || item.category || '';
  const getDistanceKm = (from, to) => {
    if (!from || !to) return null;
    const toRad = (value) => (value * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(to[0] - from[0]);
    const dLng = toRad(to[1] - from[1]);
    const lat1 = toRad(from[0]);
    const lat2 = toRad(to[0]);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const categoryFilteredListings = !activeCategory
    ? listings
    : listings.filter((item) => {
        const itemPath = normalizeKey(getListingPath(item));
        return itemPath.startsWith(activeCategory);
      });

  const distanceLimit = distanceFilter === 'all' ? null : Number(distanceFilter);
  const filteredListings = categoryFilteredListings.filter((item) => {
    if (!distanceLimit || !userLocation) return true;
    const km = getDistanceKm(userLocation, [item.lat, item.lng]);
    return km !== null && km <= distanceLimit;
  });

  const hasCategoryResults = categoryFilteredListings.length > 0;
  const hasResults = filteredListings.length > 0;
  const myActiveCount = listings.filter((item) => item.user_id === currentUserId).length;

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus('Геолокация недоступна в этом браузере');
      return;
    }

    setLocationStatus('Определяем ваше местоположение...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation([position.coords.latitude, position.coords.longitude]);
        setLocationStatus('Местоположение найдено');
      },
      () => {
        setLocationStatus('Не удалось получить геолокацию');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleBook = async (listing) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (user.id === listing.user_id) {
        showToast('Нельзя забронировать свой же лот', 'error');
        return;
      }

      const { error: txError } = await supabase.from('transactions').insert({
        listing_id: listing.id,
        giver_id: listing.user_id,
        taker_id: user.id,
      });
      if (txError) throw txError;

      const { error: updateError } = await supabase
        .from('listings')
        .update({ status: 'reserved' })
        .eq('id', listing.id);
      if (updateError) throw updateError;

      showToast("Лот забронирован. Контакты появятся во вкладке 'Сделки'.", 'success');
      fetchListings();
      window.dispatchEvent(new Event('listings-updated'));
    } catch (e) {
      showToast('Ошибка бронирования: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex h-[100svh] flex-col overflow-hidden bg-[#eaf3e9]">
      <header className="glass-panel z-[1000] rounded-b-[28px] px-4 pb-4 pt-4">
        <div className="mx-auto max-w-md">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="section-title">VratiMe</p>
              <h1 className="text-2xl font-black tracking-tight text-gray-950">Карта обмена</h1>
            </div>
            <div className="rounded-2xl bg-emerald-100 px-3 py-2 text-right">
              <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700">Активно</p>
              <p className="text-xl font-black text-emerald-800">{listings.length}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Icon name="search" size={19} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Найти банки, картон..."
                className="field h-12 min-h-12 bg-white pl-11 text-sm"
              />
            </div>
            <button type="button" className="btn-secondary h-12 min-h-12 px-3" aria-label="Фильтры">
              <Icon name="sliders" size={20} />
            </button>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className={`chip ${activeCategory === null ? 'chip-active' : ''}`}
            >
              Все
            </button>

            {mainCategoryChips.map((category) => {
              const iconFile = category.icon_url?.split('/').pop();
              const iconSrc = iconFile ? getIconUrl(iconFile) : null;
              const categoryPath = normalizeKey(category.category_path?.split('/')?.[0] || category.name);
              const isActive = activeCategory === categoryPath;

              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setActiveCategory(categoryPath)}
                  className={`chip ${isActive ? 'chip-active' : ''}`}
                >
                  {iconSrc ? <img src={iconSrc} alt="" className="h-5 w-5 object-contain" /> : null}
                  <span>{category.name}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {distanceOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setDistanceFilter(option.id)}
                className={`chip text-xs ${distanceFilter === option.id ? 'chip-active' : ''}`}
              >
                {option.label}
              </button>
            ))}
            <button type="button" onClick={requestLocation} className="chip text-xs text-emerald-700">
              <Icon name="location" size={15} />
              Рядом
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-bold text-gray-500">
            <span className="rounded-full bg-white/70 px-3 py-1">Показано: {filteredListings.length}</span>
            <span className="rounded-full bg-white/70 px-3 py-1">Моих: {myActiveCount}</span>
            {locationStatus ? <span className="rounded-full bg-white/70 px-3 py-1">{locationStatus}</span> : null}
          </div>
        </div>
      </header>

      <div className="relative z-0 min-h-0 flex-1">
        <MapContainer center={defaultPosition} zoom={13} zoomControl={false} className="h-full w-full">
          <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />

          {filteredListings.map((item) => (
            <Marker key={item.id} position={[item.lat, item.lng]} icon={item.type === 'give' ? giveIcon : takeIcon}>
              <Popup>
                <div className="w-[220px]">
                  {item.image_url ? (
                    <img src={item.image_url} alt="Фото лота" className="mb-3 h-32 w-full rounded-2xl object-cover" />
                  ) : null}
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                    <Icon name={item.type === 'give' ? 'gift' : 'truck'} size={14} />
                    {item.type === 'give' ? 'Отдают' : 'Заберут'}
                  </div>
                  <p className="text-base font-black text-gray-950">{item.category_path || item.category}</p>
                  <p className="mt-1 text-sm font-medium text-gray-500">Количество: {item.quantity} шт.</p>

                  <button
                    type="button"
                    onClick={() => handleBook(item)}
                    disabled={loading}
                    className="btn-primary mt-4 w-full text-sm"
                  >
                    <Icon name="check" size={17} />
                    {loading ? 'Секунду...' : 'Забронировать'}
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {!hasResults && (
          <div className="pointer-events-none absolute inset-x-4 bottom-32 z-[700] flex justify-center">
            <div className="card max-w-sm p-5 text-center">
              <img src={emptyImg} alt="Пусто" className="mx-auto mb-4 h-32 w-full max-w-[210px] object-contain" />
              <p className="text-lg font-black text-gray-900">
                {hasCategoryResults ? 'В этом радиусе пока пусто' : 'В этой категории пока пусто'}
              </p>
              <p className="mt-2 text-sm text-gray-500">Попробуйте расширить радиус или выбрать другую категорию.</p>
            </div>
          </div>
        )}
      </div>

      <div className="absolute bottom-28 right-5 z-[999]">
        <button type="button" onClick={() => setIsCreating(true)} className="fab flex items-center justify-center">
          <Icon name="plus" size={30} strokeWidth={2.4} />
        </button>
      </div>

      {isCreating && (
        <CreateListing
          onBack={() => setIsCreating(false)}
          onSuccess={() => {
            setIsCreating(false);
            fetchListings();
          }}
        />
      )}
    </div>
  );
}
