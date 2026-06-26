import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import successImg from '../assets/images/ill-success.png';
import { showToast } from '../lib/toast';
import Icon from '../components/Icon';

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
      showToast('Номер телефона партнёра не указан', 'error');
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
      setReviewError('Не удалось отправить отзыв. Проверь соединение и попробуй ещё раз.');
      showToast('Не удалось отправить отзыв', 'error');
    } finally {
      setSubmittingReview(false);
    }
  }

  if (loading) {
    return (
      <div className="app-screen flex min-h-screen items-center justify-center px-5 pb-28">
        <div className="card w-full max-w-sm p-6 text-center">
          <Icon name="deals" size={42} className="mx-auto text-emerald-600" />
          <p className="mt-4 text-lg font-black text-gray-950">Загружаем сделки...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-screen min-h-screen pb-28">
      <main className="app-container px-4 py-5">
        <header className="mb-5">
          <p className="section-title">Обмены</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-gray-950">Мои сделки</h1>
          <p className="mt-2 text-sm font-medium text-gray-600">Здесь хранятся брони и контакты партнёров.</p>
        </header>

        {deals.length === 0 ? (
          <section className="card mt-12 p-7 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[26px] bg-emerald-100 text-emerald-700">
              <Icon name="empty" size={40} />
            </div>
            <h2 className="mt-5 text-2xl font-black text-gray-950">Активных сделок пока нет</h2>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              Забронируйте лот на карте или дождитесь, пока кто-то откликнется на ваше объявление.
            </p>
          </section>
        ) : (
          <section className="space-y-4">
            {deals.map((deal) => {
              const isGiver = deal.giver_id === currentUserId;
              const partner = isGiver ? deal.taker : deal.giver;
              const dealStatus = deal.listings?.status === 'reserved' ? 'Ожидает передачи' : 'Активна';

              return (
                <article key={deal.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <span className={`chip h-8 min-h-8 px-3 text-xs ${isGiver ? 'chip-active' : 'border-sky-200 bg-sky-50 text-sky-700'}`}>
                          <Icon name={isGiver ? 'gift' : 'truck'} size={14} />
                          {isGiver ? 'Отдаю' : 'Забираю'}
                        </span>
                        <span className="chip h-8 min-h-8 px-3 text-xs">{dealStatus}</span>
                      </div>
                      <h2 className="mt-3 truncate text-xl font-black text-gray-950">{deal.listings.category}</h2>
                      <p className="mt-1 text-sm font-medium text-gray-500">{deal.listings.quantity} шт.</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Партнёр</p>
                      <p className="mt-1 max-w-28 truncate font-black text-gray-900">{partner?.full_name || 'Не указан'}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2">
                    <button type="button" onClick={() => openMessenger(partner)} className="btn-ghost w-full">
                      <Icon name="message" size={19} />
                      Связаться
                    </button>

                    {isGiver && (
                      <button
                        type="button"
                        onClick={() => handleCompleteDeal(deal)}
                        disabled={completing}
                        className="btn-primary w-full"
                      >
                        <Icon name="check" size={19} />
                        {completing ? 'Обработка...' : 'Завершить сделку'}
                      </button>
                    )}

                    {!isGiver && deal.listings?.status === 'reserved' && (
                      <button
                        type="button"
                        onClick={() => handleCancelBooking(deal)}
                        disabled={canceling}
                        className="btn-danger w-full"
                      >
                        <Icon name="close" size={19} />
                        {canceling ? 'Отмена...' : 'Отменить бронь'}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </main>

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

          <div className="card relative z-10 w-full max-w-sm p-6 text-center">
            <img src={successImg} alt="Успех" className="mx-auto mb-5 h-44 w-full rounded-[22px] object-cover" />
            <p className="section-title text-emerald-700">Готово</p>
            <h1 className="mt-2 text-3xl font-black text-gray-950">Сделка завершена</h1>
            <div className="my-6 rounded-[22px] bg-emerald-50 p-4">
              <p className="text-sm font-bold text-gray-600">Вы получили</p>
              <p className="mt-1 text-3xl font-black text-emerald-700">+{successDeal.ecoReward} ЭКО</p>
            </div>
            <button type="button" onClick={handleCloseSuccessModal} className="btn-primary w-full">
              Оценить партнёра
            </button>
          </div>
        </div>
      )}

      {reviewDeal && !successDeal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/80 p-4">
          <div className="card w-full max-w-sm p-6 text-center">
            <p className="section-title text-emerald-700">Отзыв</p>
            <h2 className="mt-2 text-2xl font-black text-gray-950">Как всё прошло?</h2>

            <div className="mt-6 flex items-center justify-center gap-2">
              {Array.from({ length: 5 }).map((_, index) => {
                const starValue = index + 1;
                const active = starValue <= reviewRating;
                return (
                  <button
                    key={starValue}
                    type="button"
                    onClick={() => setReviewRating(starValue)}
                    className={`rounded-2xl p-2 transition ${active ? 'text-amber-400' : 'text-gray-300 hover:text-amber-300'}`}
                    aria-label={`${starValue} star`}
                  >
                    <Icon name="star" size={30} filled={active} />
                  </button>
                );
              })}
            </div>

            <button type="button" onClick={handleSubmitReview} disabled={submittingReview} className="btn-primary mt-7 w-full">
              {submittingReview ? 'Отправка...' : 'Отправить'}
            </button>

            {reviewError && (
              <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                {reviewError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
