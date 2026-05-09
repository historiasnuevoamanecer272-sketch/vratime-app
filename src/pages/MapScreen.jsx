import { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { supabase } from '../supabaseClient';
import CreateListing from './CreateListing';
import emptyImg from '../assets/images/ill-empty.png';
import { showToast } from '../lib/toast';

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
    console.log('ID текущего пользователя:', userData?.user?.id);

    const { data, error } = await supabase
      .from('listings')
      .select('*')
      .eq('status', 'active');

    if (error) {
      console.error('Ошибка загрузки лотов для карты:', error);
      return;
    }

    console.log('Всего лотов получено для карты:', data?.length || 0);
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
        showToast('Эй, нельзя забронировать свой же лот!', 'error');
        return;
      }

      const { error: txError } = await supabase.from('transactions').insert({
        listing_id: listing.id,
        giver_id: listing.user_id,
        taker_id: user.id
      });
      if (txError) throw txError;

      const { error: updateError } = await supabase
        .from('listings')
        .update({ status: 'reserved' })
        .eq('id', listing.id);
      if (updateError) throw updateError;

      showToast("Лот успешно забронирован! Перейди во вкладку 'Сделки' для связи.", 'success');
      fetchListings();
      window.dispatchEvent(new Event('listings-updated'));
    } catch (e) {
      showToast('Ошибка бронирования: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const hasResults = filteredListings.length > 0;

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <header className="z-[1000] bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 p-4">
          <input
            type="text"
            placeholder="Найти банки, картон..."
            className="flex-grow rounded-lg border border-gray-200 bg-gray-50 p-2 outline-none focus:ring-2 focus:ring-green-500"
          />
          <button className="rounded-lg bg-green-50 p-2 font-medium text-green-700">Фильтры</button>
        </div>

        <div className="px-4 pb-3">
          <div className="flex gap-3 overflow-x-auto">
            <button
              onClick={() => setActiveCategory(null)}
              className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                activeCategory === null
                  ? 'border-green-600 bg-green-50 text-green-700'
                  : 'border-gray-200 bg-white text-gray-600'
              }`}
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
                  onClick={() => setActiveCategory(categoryPath)}
                  className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                    isActive
                      ? 'border-green-600 bg-green-50 text-green-700'
                      : 'border-gray-200 bg-white text-gray-600'
                  }`}
                >
                  {iconSrc ? <img src={iconSrc} alt="" className="h-5 w-5 object-contain" /> : null}
                  <span>{category.name}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto">
            <button
              onClick={() => setDistanceFilter('all')}
              className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                distanceFilter === 'all'
                  ? 'border-green-600 bg-green-50 text-green-700'
                  : 'border-gray-200 bg-white text-gray-600'
              }`}
            >
              Любое расстояние
            </button>
            <button
              onClick={() => setDistanceFilter('1')}
              className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                distanceFilter === '1'
                  ? 'border-green-600 bg-green-50 text-green-700'
                  : 'border-gray-200 bg-white text-gray-600'
              }`}
            >
              До 1 км
            </button>
            <button
              onClick={() => setDistanceFilter('5')}
              className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                distanceFilter === '5'
                  ? 'border-green-600 bg-green-50 text-green-700'
                  : 'border-gray-200 bg-white text-gray-600'
              }`}
            >
              До 5 км
            </button>
            <button
              onClick={() => setDistanceFilter('10')}
              className={`shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition ${
                distanceFilter === '10'
                  ? 'border-green-600 bg-green-50 text-green-700'
                  : 'border-gray-200 bg-white text-gray-600'
              }`}
            >
              До 10 км
            </button>
            <button
              onClick={requestLocation}
              className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
            >
              Рядом со мной
            </button>
          </div>

          {locationStatus ? <p className="mt-2 text-xs text-gray-500">{locationStatus}</p> : null}

          <div className="mt-3 rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>Активных лотов: {listings.length}</span>
              <span>Показано сейчас: {filteredListings.length}</span>
              <span>Моих среди активных: {listings.filter((item) => item.user_id === currentUserId).length}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="relative z-0 flex-grow">
        <MapContainer center={defaultPosition} zoom={13} zoomControl={false} className="h-full w-full">
          <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />

          {filteredListings.map((item) => (
            <Marker key={item.id} position={[item.lat, item.lng]} icon={item.type === 'give' ? giveIcon : takeIcon}>
              <Popup>
                <div className="min-w-[150px] p-1">
                  {item.image_url ? (
                    <img src={item.image_url} alt="Фото лота" className="mb-3 h-32 w-full rounded-xl object-cover" />
                  ) : null}
                  <strong className="mb-1 block text-lg">{item.type === 'give' ? '🎁 Отдаю' : '🚚 Заберу'}</strong>
                  <div className="mb-3 text-sm text-gray-600">
                    <p>Категория: {item.category_path || item.category}</p>
                    <p>Количество: {item.quantity} шт.</p>
                  </div>

                  <button
                    onClick={() => handleBook(item)}
                    disabled={loading}
                    className="w-full rounded-lg bg-green-600 py-2 font-bold text-white transition hover:bg-green-700 disabled:opacity-50"
                  >
                    {loading ? 'Секунду...' : 'Забронировать'}
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {!hasResults && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
            <div className="max-w-sm rounded-3xl bg-white/95 p-6 text-center shadow-lg">
              <img src={emptyImg} alt="Пусто" className="mx-auto mb-4 h-36 w-full max-w-[220px] object-contain" />
              <p className="text-base font-semibold text-gray-700">
                {hasCategoryResults ? 'В этом радиусе пока пусто' : 'В этой категории пока пусто'}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="absolute bottom-24 right-4 z-[999]">
        <button
          onClick={() => setIsCreating(true)}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-green-600 text-3xl text-white shadow-lg hover:scale-105"
        >
          +
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
