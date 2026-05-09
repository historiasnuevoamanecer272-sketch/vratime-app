import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import successImg from '../assets/images/ill-success.png';
import { showToast } from '../lib/toast';

const confettiColors = ['#22c55e', '#16a34a', '#86efac', '#f59e0b', '#ef4444', '#38bdf8'];

export default function MyDeals() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [successDeal, setSuccessDeal] = useState(null);
  const [reviewDeal, setReviewDeal] = useState(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewError, setReviewError] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);

  useEffect(() => {
    fetchDeals();
  }, []);

  async function fetchDeals() {
    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setCurrentUserId(null);
        setDeals([]);
        return;
      }

      setCurrentUserId(user.id);

      const { data, error } = await supabase
        .from('transactions')
        .select(`
          *,
          listings (*),
          giver:profiles!transactions_giver_id_fkey(full_name, phone, messenger_type),
          taker:profiles!transactions_taker_id_fkey(full_name, phone, messenger_type)
        `)
        .or(`giver_id.eq.${user.id},taker_id.eq.${user.id}`)
        .is('completed_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDeals(data || []);
    } catch (e) {
      console.error('Ошибка:', e.message);
    } finally {
      setLoading(false);
    }
  }

  const openMessenger = (user) => {
    if (!user?.phone) {
      showToast('Номер телефона партнера не указан', 'error');
      return;
    }

    const phone = user.phone.replace(/\D/g, '');
    if (user.messenger_type === 'wa') window.open(`https://wa.me/${phone}`, '_blank');
    else if (user.messenger_type === 'viber') window.open(`viber://add?number=${phone}`, '_blank');
    else if (user.messenger_type === 'tg') window.open(`https://t.me/${user.phone}`, '_blank');
    else showToast('Тип мессенджера не указан', 'error');
  };

  const handleCloseSuccessModal = () => {
    if (!successDeal) return;
    setReviewDeal(successDeal);
    setReviewRating(5);
    setReviewError('');
    setSuccessDeal(null);
  };

  async function handleCompleteDeal(deal) {
    if (!currentUserId) {
      showToast('Не удалось определить текущего пользователя', 'error');
      return;
    }

    setCompleting(true);

    try {
      const { error } = await supabase.rpc('complete_deal_and_add_points', {
        target_listing_id: deal.listing_id,
        giver_uuid: currentUserId,
      });

      if (error) throw error;

      const partnerId = deal.giver_id === currentUserId ? deal.taker_id : deal.giver_id;

      setSuccessDeal({
        ecoReward: 50,
        transactionId: deal.id,
        partnerId,
      });
    } catch (e) {
      showToast('Ошибка завершения сделки: ' + e.message, 'error');
    } finally {
      setCompleting(false);
    }
  }

  async function handleCancelBooking(deal) {
    if (!window.confirm('Отменить бронь и вернуть лот в активные?')) return;

    setCanceling(true);
    try {
      const [{ error: txError }, { error: listingError }] = await Promise.all([
        supabase.from('transactions').delete().eq('id', deal.id),
        supabase.from('listings').update({ status: 'active' }).eq('id', deal.listing_id),
      ]);

      if (txError) throw txError;
      if (listingError) throw listingError;

      await fetchDeals();
      showToast('Бронь отменена', 'success');
    } catch (e) {
      showToast('Не удалось отменить бронь: ' + e.message, 'error');
    } finally {
      setCanceling(false);
    }
  }

  async function handleSubmitReview() {
    if (!reviewDeal) return;

    setSubmittingReview(true);
    setReviewError('');

    try {
      const { error } = await supabase.from('reviews').insert({
        transaction_id: reviewDeal.transactionId,
        from_user_id: currentUserId,
        to_user_id: reviewDeal.partnerId,
        rating: reviewRating,
      });

      if (error) throw error;

      setReviewDeal(null);
      await fetchDeals();
      showToast('Отзыв отправлен', 'success');
    } catch {
      setReviewError('Не удалось отправить отзыв. Проверь соединение и попробуй еще раз.');
      showToast('Не удалось отправить отзыв', 'error');
    } finally {
      setSubmittingReview(false);
    }
  }

  if (loading) return <div className="p-10 text-center">Загрузка сделок...</div>;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 p-4 pb-24">
      <h2 className="mb-6 mt-4 text-2xl font-bold">Мои сделки</h2>

      {deals.length === 0 ? (
        <div className="mt-20 flex flex-col items-center text-gray-400">
          <span className="mb-4 text-6xl">📭</span>
          <p>У вас пока нет активных сделок</p>
        </div>
      ) : (
        <div className="space-y-4">
          {deals.map((deal) => {
            const isGiver = deal.giver_id === currentUserId;
            const partner = isGiver ? deal.taker : deal.giver;
            const dealStatus = deal.listings?.status === 'reserved' ? 'Ожидает передачи' : 'Активна';

            return (
              <div key={deal.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <span className={`rounded px-2 py-1 text-xs font-bold uppercase ${isGiver ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                      {isGiver ? 'Отдаю' : 'Забираю'}
                    </span>
                    <span className="ml-2 rounded bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600">
                      {dealStatus}
                    </span>
                    <h3 className="mt-2 text-lg font-bold">{deal.listings.category}</h3>
                    <p className="text-sm text-gray-500">{deal.listings.quantity} шт.</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">Партнер:</p>
                    <p className="font-medium">{partner?.full_name}</p>
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => openMessenger(partner)}
                    className="flex-grow rounded-xl bg-gray-100 py-3 text-sm font-bold text-gray-700 hover:bg-gray-200"
                  >
                    💬 Связаться
                  </button>
                  {isGiver && (
                    <button
                      onClick={() => handleCompleteDeal(deal)}
                      disabled={completing}
                      className="flex-grow rounded-xl bg-green-600 py-3 text-sm font-bold text-white transition hover:bg-green-700 disabled:opacity-50"
                    >
                      {completing ? 'Обработка...' : '✅ Завершить'}
                    </button>
                  )}
                  {!isGiver && deal.listings?.status === 'reserved' && (
                    <button
                      onClick={() => handleCancelBooking(deal)}
                      disabled={canceling}
                      className="flex-grow rounded-xl bg-rose-600 py-3 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-50"
                    >
                      {canceling ? 'Отмена...' : 'Отменить бронь'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {successDeal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-slate-950/80 p-4">
          <div className="pointer-events-none absolute inset-0">
            {Array.from({ length: 36 }).map((_, index) => (
              <span
                key={index}
                className="confetti-piece"
                style={{
                  left: `${(index * 9) % 100}%`,
                  animationDelay: `${(index % 8) * 120}ms`,
                  animationDuration: `${2200 + (index % 5) * 180}ms`,
                  backgroundColor: confettiColors[index % confettiColors.length],
                  width: `${8 + (index % 3) * 2}px`,
                  height: `${12 + (index % 4) * 2}px`,
                }}
              />
            ))}
          </div>

          <div className="relative z-10 w-full max-w-sm rounded-[32px] border border-white/20 bg-white p-6 text-center shadow-[0_30px_90px_rgba(15,23,42,0.35)]">
            <img src={successImg} alt="Успех" className="mx-auto mb-5 h-44 w-full rounded-2xl object-cover" />
            <h1 className="mb-2 text-3xl font-bold text-green-600">Сделка завершена</h1>
            <p className="mb-4 text-gray-600">+50 эко-баллов!</p>
            <div className="mb-6 rounded-2xl bg-green-50 p-4">
              <p className="text-sm text-gray-600">Вы получили</p>
              <p className="text-2xl font-bold text-green-600">+{successDeal.ecoReward} ЭКО</p>
            </div>
            <button
              onClick={handleCloseSuccessModal}
              className="w-full rounded-xl bg-green-600 py-3 font-bold text-white transition hover:bg-green-700"
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      {reviewDeal && !successDeal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-sm rounded-[32px] bg-white p-6 text-center shadow-[0_30px_90px_rgba(15,23,42,0.35)]">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-green-600">Оцените партнера</p>
            <h2 className="mt-2 text-2xl font-bold text-gray-900">Как всё прошло?</h2>

            <div className="mt-6 flex items-center justify-center gap-2">
              {Array.from({ length: 5 }).map((_, index) => {
                const starValue = index + 1;
                const active = starValue <= reviewRating;
                return (
                  <button
                    key={starValue}
                    type="button"
                    onClick={() => setReviewRating(starValue)}
                    className={`text-4xl transition ${active ? 'text-yellow-400' : 'text-gray-300 hover:text-yellow-300'}`}
                    aria-label={`${starValue} star`}
                  >
                    ⭐
                  </button>
                );
              })}
            </div>

            <button
              onClick={handleSubmitReview}
              disabled={submittingReview}
              className="mt-8 w-full rounded-xl bg-green-600 py-3 font-bold text-white transition hover:bg-green-700 disabled:opacity-50"
            >
              {submittingReview ? 'Отправка...' : 'Отправить'}
            </button>

            {reviewError && (
              <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">
                {reviewError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
