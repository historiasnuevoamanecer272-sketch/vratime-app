import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { showToast } from '../lib/toast';
import Icon from '../components/Icon';

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
      showToast('Профиль обновлён', 'success');
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

  if (loading) {
    return (
      <div className="app-screen flex min-h-screen items-center justify-center px-5 pb-28">
        <div className="card w-full max-w-sm p-6 text-center">
          <Icon name="user" size={42} className="mx-auto text-emerald-600" />
          <p className="mt-4 text-lg font-black text-gray-950">Загружаем профиль...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="app-screen flex min-h-screen items-center justify-center px-5 pb-28">
        <div className="card w-full max-w-sm p-6 text-center">
          <Icon name="close" size={42} className="mx-auto text-red-500" />
          <p className="mt-4 text-lg font-black text-gray-950">Ошибка загрузки профиля</p>
        </div>
      </div>
    );
  }

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
    { icon: getBadgeUrl('badge-first.png'), label: 'Первая сделка', unlocked: completedDealsCount > 0 },
    { icon: getBadgeUrl('badge-glass-king.png'), label: 'Стекло', unlocked: glassDealsCount > 0 },
    { icon: getBadgeUrl('badge-egg-master.png'), label: 'Ячейки', unlocked: false },
    { icon: getBadgeUrl('badge-cloth-pro.png'), label: 'Текстиль', unlocked: clothDealsCount > 0 },
    { icon: getBadgeUrl('badge-fast.png'), label: 'Пунктуальность', unlocked: completedDealsCount >= 3 },
    { icon: getBadgeUrl('badge-star.png'), label: 'Рейтинг', unlocked: ratingValue >= 5 && completedDealsCount > 0 },
  ];

  return (
    <div className="app-screen min-h-screen pb-28">
      <main className="app-container px-4 py-5">
        <section className="card overflow-hidden">
          <div className="bg-gradient-to-br from-emerald-600 via-emerald-500 to-sky-500 p-5 text-white">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] bg-white/20 text-2xl font-black ring-1 ring-white/30">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-white/75">Профиль</p>
                  {!isEditing ? (
                    <>
                      <h1 className="mt-1 truncate text-3xl font-black tracking-tight">{profile.full_name}</h1>
                      <p className="mt-1 truncate text-sm font-semibold text-white/80">
                        {messengerLabels[profile.messenger_type] || 'Мессенджер не указан'}
                        {profile.phone ? ` / ${profile.phone}` : ''}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-2xl font-black">Редактирование</p>
                  )}
                </div>
              </div>

              {!isEditing ? (
                <button
                  type="button"
                  onClick={startEditing}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-white ring-1 ring-white/25"
                  aria-label="Редактировать"
                >
                  <Icon name="edit" size={20} />
                </button>
              ) : null}
            </div>
          </div>

          <div className="p-5">
            {isEditing ? (
              <div className="space-y-3">
                <input
                  type="text"
                  value={editForm.full_name}
                  onChange={(e) => setEditForm((current) => ({ ...current, full_name: e.target.value }))}
                  placeholder="Имя"
                  className="field"
                />
                <select
                  value={editForm.messenger_type}
                  onChange={(e) => setEditForm((current) => ({ ...current, messenger_type: e.target.value }))}
                  className="field"
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
                  className="field"
                />
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <button type="button" onClick={handleSaveProfile} disabled={savingProfile} className="btn-primary">
                    {savingProfile ? 'Сохраняем...' : 'Сохранить'}
                  </button>
                  <button type="button" onClick={cancelEditing} disabled={savingProfile} className="btn-ghost">
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-[20px] bg-amber-50 p-4">
                    <p className="text-xs font-black uppercase tracking-wide text-amber-700">Рейтинг</p>
                    <p className="mt-2 flex items-center gap-2 text-3xl font-black text-amber-500">
                      <Icon name="star" size={27} filled />
                      {ratingValue.toFixed(1)}
                    </p>
                  </div>
                  <div className="rounded-[20px] bg-emerald-50 p-4">
                    <p className="text-xs font-black uppercase tracking-wide text-emerald-700">Эко-баллы</p>
                    <p className="mt-2 text-3xl font-black text-emerald-700">{displayEcoPoints}</p>
                  </div>
                </div>

                <div className="mt-5 rounded-[22px] bg-gray-50 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="section-title">Текущий уровень</p>
                      <h2 className="mt-1 text-xl font-black text-gray-950">{currentLevel.name}</h2>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-emerald-700 shadow-sm">
                      {displayEcoPoints} XP
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-gray-200">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-green-500 transition-all duration-500"
                      style={{ width: `${levelProgress}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs font-semibold text-gray-500">
                    Следующий уровень: {nextLevel.name}
                  </p>
                </div>

                <div className="mt-5 grid grid-cols-4 gap-2 text-center">
                  {[
                    ['Сделок', completedDealsCount],
                    ['Категорий', uniqueCategories],
                    ['Стекло', glassDealsCount],
                    ['Текстиль', clothDealsCount],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl bg-gray-50 px-2 py-3">
                      <p className="text-xl font-black text-gray-950">{value}</p>
                      <p className="mt-1 text-[10px] font-black uppercase tracking-wide text-gray-400">{label}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-5 h-2 overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${ecoProgress}%` }}
                  />
                </div>
                <button type="button" onClick={handleSignOut} className="btn-danger mt-5 w-full">
                  <Icon name="logout" size={20} />
                  Выйти
                </button>
              </>
            )}
          </div>
        </section>

        <section className="mt-4 card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="section-title">Достижения</p>
              <h2 className="mt-1 text-xl font-black text-gray-950">Бейджи</h2>
            </div>
            <Icon name="award" size={26} className="text-emerald-600" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {achievements.map((achievement) => (
              <div key={achievement.label} className={`rounded-[20px] p-3 text-center ${achievement.unlocked ? 'bg-emerald-50' : 'bg-gray-50'}`}>
                <img
                  src={achievement.icon}
                  alt={achievement.label}
                  className={`mx-auto mb-2 h-12 w-12 object-contain ${achievement.unlocked ? '' : 'grayscale opacity-45'}`}
                />
                <span className="text-xs font-black leading-4 text-gray-700">{achievement.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-4 card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="section-title">Публикации</p>
              <h2 className="mt-1 text-xl font-black text-gray-950">Мои объявления</h2>
            </div>
            <span className="chip h-8 min-h-8 px-3 text-xs">{myListings.length} шт.</span>
          </div>

          {myListingsLoading ? (
            <p className="text-sm font-medium text-gray-500">Загружаем ваши объявления...</p>
          ) : myListings.length === 0 ? (
            <p className="rounded-2xl bg-gray-50 p-4 text-sm font-medium leading-6 text-gray-500">
              Вы ещё ничего не отдавали. Создайте первый лот на карте.
            </p>
          ) : (
            <div className="space-y-3">
              {myListings.map((listing) => (
                <article key={listing.id} className="rounded-[20px] bg-gray-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {listing.image_url ? (
                        <img src={listing.image_url} alt="Фото лота" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                      ) : (
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700">
                          <Icon name="box" size={24} />
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-black text-gray-950">{listing.category || listing.category_path}</p>
                        <p className="mt-1 text-sm font-medium text-gray-500">
                          {new Date(listing.created_at).toLocaleDateString('ru-RU')}
                        </p>
                      </div>
                    </div>
                    <span className={`chip h-8 min-h-8 px-3 text-xs ${listing.type === 'give' ? 'chip-active' : 'border-sky-200 bg-sky-50 text-sky-700'}`}>
                      {listing.type === 'give' ? 'Отдаю' : 'Заберу'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteListing(listing.id)}
                    disabled={deletingListingId === listing.id}
                    className="btn-danger mt-3 w-full text-sm"
                  >
                    {deletingListingId === listing.id ? 'Удаляем...' : 'Снять с публикации'}
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="mt-4 card p-5">
          <p className="section-title">Отзывы</p>
          <h2 className="mt-1 text-xl font-black text-gray-950">Последние оценки</h2>
          {reviews.length === 0 ? (
            <p className="mt-4 rounded-2xl bg-gray-50 p-4 text-sm font-medium text-gray-500">Пока отзывов нет.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {reviews.map((review) => (
                <article key={review.id} className="rounded-[20px] bg-gray-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate font-black text-gray-900">{review.from_user?.full_name || 'Партнёр'}</p>
                    <span className="flex items-center gap-1 font-black text-amber-500">
                      <Icon name="star" size={17} filled />
                      {Number(review.rating).toFixed(1)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-gray-500">
                    {new Date(review.created_at).toLocaleDateString('ru-RU')}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
