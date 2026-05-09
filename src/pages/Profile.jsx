import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { showToast } from '../lib/toast';

const getBadgeUrl = (name) => new URL(`../assets/icons/${name}`, import.meta.url).href;

const messengerLabels = {
  wa: 'WhatsApp',
  viber: 'Viber',
  tg: 'Telegram',
};

export default function Profile() {
  const [profile, setProfile] = useState(null);
  const [dealHistory, setDealHistory] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [myListings, setMyListings] = useState([]);
  const [myListingsLoading, setMyListingsLoading] = useState(true);
  const [deletingListingId, setDeletingListingId] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [editForm, setEditForm] = useState({
    full_name: '',
    messenger_type: 'wa',
    phone: '',
  });
  const [loading, setLoading] = useState(true);

  async function fetchProfile() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setProfile(null);
        setDealHistory([]);
        setReviews([]);
        setMyListings([]);
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('full_name, eco_points, rating, messenger_type, phone')
        .eq('id', user.id)
        .single();

      if (error) throw error;
      setProfile(data);

      const { data: historyData, error: historyError } = await supabase
        .from('transactions')
        .select('id, listings(category_path)')
        .or(`giver_id.eq.${user.id},taker_id.eq.${user.id}`)
        .not('completed_at', 'is', null);

      if (historyError) throw historyError;
      setDealHistory(historyData || []);

      const { data: reviewsData, error: reviewsError } = await supabase
        .from('reviews')
        .select(`
          id,
          rating,
          created_at,
          from_user:profiles!reviews_from_user_id_fkey(full_name)
        `)
        .eq('to_user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(3);

      if (reviewsError) throw reviewsError;
      setReviews(reviewsData || []);

      const { data: listingsData, error: listingsError } = await supabase
        .from('listings')
        .select('id, category, category_path, created_at, status, type, image_url')
        .eq('user_id', user.id)
        .in('status', ['active', 'reserved'])
        .order('created_at', { ascending: false });

      if (listingsError) throw listingsError;
      setMyListings(listingsData || []);
    } catch (e) {
      console.error('Ошибка загрузки профиля:', e.message);
    } finally {
      setLoading(false);
      setMyListingsLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProfile();
  }, []);

  const startEditing = () => {
    setEditForm({
      full_name: profile.full_name || '',
      messenger_type: profile.messenger_type || 'wa',
      phone: profile.phone || '',
    });
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  async function handleSaveProfile() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      showToast('Не удалось определить текущего пользователя', 'error');
      return;
    }

    setSavingProfile(true);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: editForm.full_name.trim(),
          messenger_type: editForm.messenger_type,
          phone: editForm.phone.trim(),
        })
        .eq('id', user.id);

      if (error) throw error;

      setProfile((current) => ({
        ...current,
        full_name: editForm.full_name.trim(),
        messenger_type: editForm.messenger_type,
        phone: editForm.phone.trim(),
      }));
      setIsEditing(false);
      showToast('Профиль обновлен', 'success');
    } catch (e) {
      console.error('Ошибка обновления профиля:', e);
      showToast('Не удалось сохранить профиль: ' + e.message, 'error');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.replace('/');
  }

  async function handleDeleteListing(listingId) {
    if (!window.confirm('Снять объявление с публикации?')) return;

    setDeletingListingId(listingId);
    try {
      const { error } = await supabase.from('listings').update({ status: 'canceled' }).eq('id', listingId);
      if (error) throw error;

      await fetchProfile();
      window.dispatchEvent(new Event('listings-updated'));
      showToast('Объявление снято с публикации', 'success');
    } catch (e) {
      console.error('Ошибка удаления объявления:', e.message);
      showToast('Не удалось снять объявление с публикации: ' + e.message, 'error');
    } finally {
      setDeletingListingId(null);
    }
  }

  if (loading) return <div className="flex h-screen items-center justify-center">Загрузка...</div>;
  if (!profile) return <div className="flex h-screen items-center justify-center">Ошибка загрузки профиля</div>;

  const displayRating = profile.rating ?? 5.0;
  const displayEcoPoints = profile.eco_points ?? 0;
  const initials = profile.full_name?.trim()?.charAt(0)?.toUpperCase() || 'V';
  const ratingValue = Number(displayRating) || 5.0;
  const maxEcoPoints = 500;
  const ecoProgress = Math.min((displayEcoPoints / maxEcoPoints) * 100, 100);

  const completedDealsCount = dealHistory.length;
  const glassDealsCount = dealHistory.filter((deal) => deal.listings?.category_path?.startsWith('glass')).length;
  const clothDealsCount = dealHistory.filter((deal) => deal.listings?.category_path?.startsWith('cloth')).length;
  const uniqueCategories = new Set(
    dealHistory
      .map((deal) => deal.listings?.category_path)
      .filter(Boolean)
      .map((categoryPath) => categoryPath.split('/')[0])
  ).size;

  const levelThresholds = [
    { name: 'Эко-Новичок', threshold: 0 },
    { name: 'Эко-Активист', threshold: 100 },
    { name: 'Эко-Помощник', threshold: 200 },
    { name: 'Эко-Герой', threshold: 300 },
    { name: 'Эко-Амбассадор', threshold: 400 },
  ];
  const levelIndex = Math.min(Math.floor(displayEcoPoints / 100), levelThresholds.length - 1);
  const currentLevel = levelThresholds[levelIndex];
  const nextLevel = levelThresholds[Math.min(levelIndex + 1, levelThresholds.length - 1)];
  const levelProgress = Math.min(((displayEcoPoints - currentLevel.threshold) / 100) * 100, 100);

  const achievements = [
    { icon: getBadgeUrl('badge-first.png'), label: 'Первая сделка', unlocked: false },
    { icon: getBadgeUrl('badge-glass-king.png'), label: 'Стекло', unlocked: false },
    { icon: getBadgeUrl('badge-egg-master.png'), label: 'Ячейки', unlocked: false },
    { icon: getBadgeUrl('badge-cloth-pro.png'), label: 'Текстиль', unlocked: false },
    { icon: getBadgeUrl('badge-fast.png'), label: 'Пунктуальность', unlocked: false },
    { icon: getBadgeUrl('badge-star.png'), label: 'Рейтинг', unlocked: false },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-gray-50 pb-24">
      <div className="p-4 pt-6">
        <div className="mx-auto max-w-md rounded-3xl border border-emerald-100 bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 text-2xl font-bold text-white">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-600">Профиль</p>
                {!isEditing ? (
                  <>
                    <h1 className="truncate text-3xl font-bold text-gray-900">{profile.full_name}</h1>
                    <p className="mt-1 text-xs text-gray-500">
                      {messengerLabels[profile.messenger_type] || 'Мессенджер не указан'}
                      {profile.phone ? ` • ${profile.phone}` : ''}
                    </p>
                  </>
                ) : (
                  <div className="mt-3 space-y-3">
                    <input
                      type="text"
                      value={editForm.full_name}
                      onChange={(e) => setEditForm((current) => ({ ...current, full_name: e.target.value }))}
                      placeholder="Имя"
                      className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-gray-900 outline-none focus:border-emerald-500"
                    />
                    <select
                      value={editForm.messenger_type}
                      onChange={(e) => setEditForm((current) => ({ ...current, messenger_type: e.target.value }))}
                      className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-gray-900 outline-none focus:border-emerald-500"
                    >
                      <option value="wa">WhatsApp</option>
                      <option value="viber">Viber</option>
                      <option value="tg">Telegram</option>
                    </select>
                    <input
                      type="tel"
                      value={editForm.phone}
                      onChange={(e) => setEditForm((current) => ({ ...current, phone: e.target.value }))}
                      placeholder="Телефон"
                      className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-gray-900 outline-none focus:border-emerald-500"
                    />
                  </div>
                )}
              </div>
            </div>

            {!isEditing ? (
              <button
                type="button"
                onClick={startEditing}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100"
              >
                <span>✏️</span>
                <span>Редактировать</span>
              </button>
            ) : null}
          </div>

          {isEditing ? (
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={handleSaveProfile}
                disabled={savingProfile}
                className="flex-1 rounded-2xl bg-emerald-600 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {savingProfile ? 'Сохраняем...' : 'Сохранить'}
              </button>
              <button
                type="button"
                onClick={cancelEditing}
                disabled={savingProfile}
                className="flex-1 rounded-2xl border border-gray-200 bg-white py-3 text-sm font-bold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                Отмена
              </button>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Рейтинг</p>
                <p className="mt-2 text-3xl font-bold text-yellow-500">{ratingValue.toFixed(1)}</p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Эко-баллы</p>
                <p className="mt-2 text-3xl font-bold text-emerald-600">{displayEcoPoints}</p>
              </div>
            </div>
          )}

          {!isEditing ? (
            <>
              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-gray-600">Эко-статус</h2>
                  <span className="text-sm font-semibold text-emerald-700">{displayEcoPoints} баллов</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-green-500 transition-all duration-500"
                    style={{ width: `${ecoProgress}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {Math.max(maxEcoPoints - displayEcoPoints, 0)} баллов до следующего уровня
                </p>
              </div>

              <div className="mt-6 rounded-2xl bg-emerald-50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Текущий уровень</p>
                    <h3 className="mt-1 text-xl font-bold text-gray-900">{currentLevel.name}</h3>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-700 shadow-sm">
                    {displayEcoPoints} XP
                  </span>
                </div>
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-gray-600">
                    <span>Прогресс к следующему уровню</span>
                    <span>{nextLevel.name}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-emerald-100">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${levelProgress}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Завершено сделок</p>
                  <p className="mt-2 text-3xl font-bold text-gray-900">{completedDealsCount}</p>
                </div>
                <div className="rounded-2xl bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Категорий</p>
                  <p className="mt-2 text-3xl font-bold text-gray-900">{uniqueCategories}</p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Стекло</p>
                  <p className="mt-2 text-2xl font-bold text-gray-900">{glassDealsCount}</p>
                </div>
                <div className="rounded-2xl bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Текстиль</p>
                  <p className="mt-2 text-2xl font-bold text-gray-900">{clothDealsCount}</p>
                </div>
              </div>
            </>
          ) : null}

          {!isEditing ? (
            <button
              onClick={handleSignOut}
              className="mt-6 w-full rounded-2xl bg-red-600 py-4 text-lg font-bold text-white transition hover:bg-red-700"
            >
              Выйти
            </button>
          ) : null}
        </div>
      </div>

      <div className="m-4 rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-sm font-bold text-gray-600">ДОСТИЖЕНИЯ</h2>
        <p className="mb-4 text-xs text-gray-500">Серые бейджи еще не открыты. Выполняй условия, чтобы они загорелись цветом.</p>
        <div className="grid grid-cols-3 gap-4">
          {achievements.map((achievement, idx) => (
            <div key={idx} className="flex flex-col items-center rounded-2xl bg-gray-50 p-4 transition hover:bg-emerald-50">
              <img
                src={achievement.icon}
                alt={achievement.label}
                className={`mb-2 h-12 w-12 object-contain ${achievement.unlocked === false ? 'grayscale opacity-50' : ''}`}
              />
              <span className="text-center text-xs font-medium text-gray-700">{achievement.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="m-4 rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-600">МОИ ОБЪЯВЛЕНИЯ</h2>
          <span className="text-xs font-medium text-gray-400">{myListings.length} шт.</span>
        </div>

        {myListingsLoading ? (
          <p className="text-sm text-gray-500">Загружаем ваши объявления...</p>
        ) : myListings.length === 0 ? (
          <p className="text-sm text-gray-500">Вы еще ничего не отдавали. Начните спасать планету!</p>
        ) : (
          <div className="space-y-3">
            {myListings.map((listing) => (
              <div key={listing.id} className="rounded-2xl bg-gray-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    {listing.image_url ? (
                      <img src={listing.image_url} alt="Фото лота" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                    ) : null}
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{listing.category || listing.category_path}</p>
                      <p className="mt-1 text-sm text-gray-500">
                        {new Date(listing.created_at).toLocaleDateString('ru-RU')}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      listing.type === 'give' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'
                    }`}
                  >
                    {listing.type === 'give' ? 'Отдаю' : 'Заберу'}
                  </span>
                </div>
                <button
                  onClick={() => handleDeleteListing(listing.id)}
                  disabled={deletingListingId === listing.id}
                  className="mt-3 w-full rounded-xl bg-red-600 py-3 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
                >
                  {deletingListingId === listing.id ? 'Удаляем...' : 'Снять с публикации'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="m-4 rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-bold text-gray-600">КАК ОТКРЫВАЮТСЯ БЕЙДЖИ</h2>
        <div className="space-y-3 text-sm text-gray-600">
          <p><span className="font-semibold text-gray-900">Первая сделка</span> - получи хотя бы 1 эко-балл.</p>
          <p><span className="font-semibold text-gray-900">Стекло</span> - закрой хотя бы одну сделку категории glass.</p>
          <p><span className="font-semibold text-gray-900">Рейтинг</span> - держи рейтинг 5.0 и заверши хотя бы одну сделку.</p>
          <p><span className="font-semibold text-gray-900">Текстиль</span> - закрой хотя бы одну сделку категории cloth.</p>
        </div>
      </div>

      <div className="m-4 rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-bold text-gray-600">ПОСЛЕДНИЕ ОТЗЫВЫ</h2>
        {reviews.length === 0 ? (
          <p className="text-sm text-gray-500">Пока отзывов нет.</p>
        ) : (
          <div className="space-y-3">
            {reviews.map((review) => (
              <div key={review.id} className="rounded-2xl bg-gray-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-gray-800">{review.from_user?.full_name || 'Партнер'}</p>
                  <span className="font-bold text-yellow-500">{review.rating.toFixed(1)} звёзд</span>
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  {new Date(review.created_at).toLocaleDateString('ru-RU')}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
