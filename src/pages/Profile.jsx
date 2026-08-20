import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';
import { getMyDeals, saveMyProfile } from '../lib/api';
import { listingCategoryLabel } from '../lib/categories';
import { getAppLanguage, setAppLanguage } from '../i18n';
import { showToast } from '../lib/toast';
import Icon from '../components/Icon';

const badgeAssets = import.meta.glob('../assets/icons/badge-*.png', { eager: true, import: 'default' });
const badge = (file) => badgeAssets[`../assets/icons/${file}`];

export default function Profile() {
  const { t } = useTranslation();
  const language = getAppLanguage();
  const [profile, setProfile] = useState(null);
  const [deals, setDeals] = useState([]);
  const [listings, setListings] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(null);
  const [form, setForm] = useState({ full_name: '', language, messenger_type: 'viber', contact_value: '' });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return setLoading(false);
    const [profileResult, contactResult, dealResult, listingResult, reviewResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('profile_contacts').select('messenger_type, contact_value').eq('user_id', userId).maybeSingle(),
      getMyDeals().then((data) => ({ data })).catch((error) => ({ error })),
      supabase.from('listings').select('*').eq('user_id', userId).neq('status', 'canceled').order('created_at', { ascending: false }),
      supabase.from('reviews').select('id, rating, created_at, from_user:profiles!reviews_from_user_id_fkey(full_name)').eq('to_user_id', userId).order('created_at', { ascending: false }).limit(5),
    ]);
    const firstError = profileResult.error || contactResult.error || dealResult.error || listingResult.error || reviewResult.error;
    if (firstError) setError(firstError.message);
    setProfile(profileResult.data || null); setDeals(dealResult.data || []); setListings(listingResult.data || []); setReviews(reviewResult.data || []);
    if (profileResult.data) {
      const nextLanguage = profileResult.data.preferred_language || profileResult.data.language || language;
      setForm({ full_name: profileResult.data.full_name || '', language: nextLanguage, messenger_type: contactResult.data?.messenger_type || 'viber', contact_value: contactResult.data?.contact_value || '' });
    }
    setLoading(false);
  }, [language]);

  useEffect(() => {
    const initialLoad = window.setTimeout(load, 0);
    const refresh = () => load();
    window.addEventListener('profile-updated', refresh);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener('profile-updated', refresh);
    };
  }, [load]);

  const completedDeals = useMemo(() => deals.filter((deal) => deal.completed_at && !deal.canceled_at), [deals]);
  const itemCount = completedDeals.reduce((sum, deal) => sum + Number(deal.quantity || 0), 0);
  const ecoPoints = Number(profile?.eco_points || 0);
  const levelIndex = Math.min(Math.floor(ecoPoints / 100), 4);
  const levels = t('profile.levels', { returnObjects: true });
  const levelProgress = levelIndex === 4 ? 100 : ecoPoints % 100;
  const rating = Number(profile?.rating || 0);
  const achievements = [
    { label: t('profile.firstDeal'), image: badge('badge-first.png'), unlocked: completedDeals.length >= 1 },
    { label: t('profile.fiveDeals'), image: badge('badge-fast.png'), unlocked: completedDeals.length >= 5 },
    { label: t('profile.fiftyItems'), image: badge('badge-hero.png'), unlocked: itemCount >= 50 },
    { label: t('profile.topRating'), image: badge('badge-star.png'), unlocked: rating >= 4.8 && completedDeals.length > 0 },
  ];

  const save = async () => {
    setSaving(true);
    try {
      await saveMyProfile({ ...form, full_name: form.full_name.trim(), contact_value: form.contact_value.trim() });
      setAppLanguage(form.language); setEditing(false); showToast(t('profile.saved'), 'success'); await load();
    } catch (saveError) { showToast(`${t('errors.save')} ${saveError.message}`, 'error'); }
    finally { setSaving(false); }
  };

  const deactivate = async (listingId) => {
    setDeactivating(listingId);
    const { error: updateError } = await supabase.from('listings').update({ status: 'canceled' }).eq('id', listingId).eq('status', 'active');
    setDeactivating(null);
    if (updateError) return showToast(updateError.message, 'error');
    window.dispatchEvent(new Event('listings-updated')); await load();
  };

  if (loading) return <div className="app-screen grid min-h-screen place-items-center pb-28"><div className="state-card"><span className="spinner" />{t('common.loading')}</div></div>;
  if (error && !profile) return <div className="app-screen grid min-h-screen place-items-center px-5 pb-28"><div className="state-card"><Icon name="close" size={28} /><strong>{t('errors.load')}</strong><button type="button" className="btn-secondary" onClick={load}>{t('common.retry')}</button></div></div>;

  return (
    <div className="app-screen min-h-screen pb-28 pt-safe">
      <main className="app-container px-4 py-5">
        <section className="profile-hero">
          <div className="flex items-start justify-between gap-3"><div className="profile-avatar">{profile?.full_name?.trim()?.charAt(0)?.toUpperCase() || 'V'}</div><button type="button" className="profile-edit" onClick={() => setEditing((value) => !value)} aria-label={t('profile.edit')}><Icon name={editing ? 'close' : 'edit'} size={19} /></button></div>
          <p className="eyebrow mt-5 text-white/65">{t('profile.eyebrow')}</p><h1 className="font-display mt-1 text-4xl text-white">{profile?.full_name}</h1>
          <div className="mt-5 grid grid-cols-2 gap-3"><div className="hero-stat"><small>{t('profile.ecoPoints')}</small><strong>{ecoPoints}</strong></div><div className="hero-stat"><small>{t('profile.rating')}</small><strong><Icon name="star" size={20} filled />{rating ? rating.toFixed(1) : '—'}</strong></div></div>
        </section>

        {editing ? <section className="card -mt-4 rounded-t-none p-5">
          <div className="space-y-4"><label className="block"><span className="field-label">{t('profile.name')}</span><input className="field" value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} /></label><label className="block"><span className="field-label">{t('profile.language')}</span><select className="field" value={form.language} onChange={(event) => setForm((current) => ({ ...current, language: event.target.value }))}><option value="me">Crnogorski</option><option value="ru">Русский</option><option value="en">English</option></select></label><label className="block"><span className="field-label">{t('profile.messenger')}</span><select className="field" value={form.messenger_type} onChange={(event) => setForm((current) => ({ ...current, messenger_type: event.target.value }))}><option value="viber">Viber</option><option value="wa">WhatsApp</option><option value="tg">Telegram</option></select></label><label className="block"><span className="field-label">{t('profile.contact')}</span><input className="field" value={form.contact_value} onChange={(event) => setForm((current) => ({ ...current, contact_value: event.target.value }))} /></label><button type="button" className="btn-primary w-full" disabled={saving} onClick={save}>{saving ? t('onboarding.saving') : t('common.save')}</button></div>
        </section> : null}

        <section className="impact-grid mt-4"><div className="impact-card"><span><Icon name="deals" size={21} /></span><strong>{completedDeals.length}</strong><small>{t('profile.deals')}</small></div><div className="impact-card"><span><Icon name="leaf" size={21} /></span><strong>{itemCount}</strong><small>{t('profile.items')}</small></div></section>

        <section className="card mt-4 p-5"><div className="flex items-center justify-between"><div><p className="eyebrow text-sea">{t('profile.level')}</p><h2 className="font-display mt-1 text-2xl text-forest">{levels[levelIndex]}</h2></div><span className="level-number">{levelIndex + 1}</span></div><div className="level-track mt-5"><span style={{ width: `${levelProgress}%` }} /></div><p className="mt-2 text-xs font-semibold text-muted">{levelIndex === 4 ? t('profile.maxLevel') : t('profile.nextLevel', { count: 100 - levelProgress })}</p></section>

        <section className="card mt-4 p-5"><div className="section-head"><div><p className="eyebrow text-sea">VratiMe</p><h2 className="font-display mt-1 text-2xl text-forest">{t('profile.achievements')}</h2></div><Icon name="award" size={24} /></div><div className="mt-4 grid grid-cols-4 gap-2">{achievements.map((item) => <div key={item.label} className={`achievement ${item.unlocked ? 'unlocked' : ''}`}><img src={item.image} alt="" /><span>{item.label}</span></div>)}</div></section>

        <section className="card mt-4 p-5"><div className="section-head"><h2 className="font-display text-2xl text-forest">{t('profile.listings')}</h2><span className="count-pill">{listings.length}</span></div>{listings.length ? <div className="mt-4 space-y-3">{listings.map((listing) => <article key={listing.id} className="profile-listing">{listing.image_url ? <img src={listing.image_url} alt="" /> : <span><Icon name="box" size={22} /></span>}<div className="min-w-0 flex-1"><strong>{listingCategoryLabel(listing, language)}</strong><small>{t('common.pieces', { count: listing.quantity })} · {t(`status.${listing.status}`)}</small></div>{listing.status === 'active' ? <button type="button" className="icon-button danger" disabled={deactivating === listing.id} onClick={() => deactivate(listing.id)} aria-label={t('profile.deactivate')}><Icon name="close" size={17} /></button> : null}</article>)}</div> : <p className="empty-copy mt-4">{t('profile.noListings')}</p>}</section>

        <section className="card mt-4 p-5"><h2 className="font-display text-2xl text-forest">{t('profile.reviews')}</h2>{reviews.length ? <div className="mt-4 space-y-3">{reviews.map((review) => <article key={review.id} className="review-row"><div><strong>{review.from_user?.full_name || t('common.partner')}</strong><small>{new Date(review.created_at).toLocaleDateString(language === 'me' ? 'sr-ME' : language)}</small></div><span><Icon name="star" size={17} filled />{Number(review.rating).toFixed(1)}</span></article>)}</div> : <p className="empty-copy mt-4">{t('profile.noReviews')}</p>}</section>
        <button type="button" className="btn-ghost mt-4 w-full" onClick={() => supabase.auth.signOut()}><Icon name="logout" size={19} />{t('profile.logout')}</button>
      </main>
    </div>
  );
}
