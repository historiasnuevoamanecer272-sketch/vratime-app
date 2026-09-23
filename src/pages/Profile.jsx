import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';
import { createFeedback, deactivateListing, getEcoLeaderboard, getImpactTotals, getMyDeals, getMyReliability, saveMyProfile, setMyAvatar, setRankingParticipation } from '../lib/api';
import { listingCategoryLabel } from '../lib/categories';
import { getAppLanguage, setAppLanguage } from '../i18n';
import { contactsToMap, emptyContactMap, validateContacts } from '../lib/contacts';
import { showToast } from '../lib/toast';
import Icon from '../components/Icon';
import CategoryIcon from '../components/CategoryIcon';
import ContactChannelsFields from '../components/ContactChannelsFields';
import SupportFund from '../components/SupportFund';
import logo from '../assets/images/app-logo.png';
import { LEVELS, getLevelProgress } from '../lib/levels';
import DeadlineCountdown from '../components/DeadlineCountdown';
import StaffPanel from '../components/StaffPanel';
let profileCache = null;

function ProfileDealSection({ title, deals, language, t }) {
  return <section className="card mt-4 p-5"><div className="section-head"><h2 className="font-display text-2xl text-forest">{title}</h2><span className="count-pill">{deals.length}</span></div>{deals.length ? <div className="mt-4 space-y-3">{deals.map((deal) => <article key={deal.transaction_id} className="profile-deal"><div className="min-w-0 flex-1"><strong>{listingCategoryLabel(deal, language)}</strong><small>{deal.partner_name || t('common.partner')} · {t(`status.${deal.status}`)}</small>{deal.expires_at && !deal.canceled_at && !deal.completed_at ? <DeadlineCountdown compact startedAt={deal.accepted_at || deal.created_at} expiresAt={deal.expires_at} /> : null}</div></article>)}</div> : <p className="empty-copy mt-4">{t('workflow.sectionEmpty')}</p>}</section>;
}

export default function Profile({ userId, onEditListing }) {
  const { t } = useTranslation();
  const language = getAppLanguage();
  const cached = profileCache?.userId === userId ? profileCache : null;
  const [profile, setProfile] = useState(cached?.profile || null);
  const [deals, setDeals] = useState(cached?.deals || []);
  const [listings, setListings] = useState(cached?.listings || []);
  const [reviews, setReviews] = useState(cached?.reviews || []);
  const [leaderboard, setLeaderboard] = useState(cached?.leaderboard || []);
  const [feedbackHistory, setFeedbackHistory] = useState(cached?.feedbackHistory || []);
  const [reliability, setReliability] = useState(cached?.reliability || null);
  const [impact, setImpact] = useState(cached?.impact || null);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [levelsOpen, setLevelsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedback, setFeedback] = useState({ type: 'feature', message: '', screenshot: null });
  const [form, setForm] = useState({ full_name: cached?.profile?.full_name || '', language, contacts: cached?.contacts || emptyContactMap(), ranking_opt_in: cached?.profile?.ranking_opt_in ?? true });

  const load = useCallback(async () => {
    if (profileCache?.userId !== userId) setLoading(true);
    setError('');
    if (!userId) return setLoading(false);
    const [profileResult, contactResult, dealResult, listingResult, reviewResult, leaderboardResult, feedbackResult, reliabilityResult, impactResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('profile_contacts').select('messenger_type, contact_value').eq('user_id', userId),
      getMyDeals().then((data) => ({ data })).catch((error) => ({ error })),
      supabase.from('listings').select('*').eq('user_id', userId).neq('status', 'canceled').order('created_at', { ascending: false }),
      supabase.from('reviews').select('id, rating, created_at, from_user:profiles!reviews_from_user_id_fkey(full_name)').eq('to_user_id', userId).order('created_at', { ascending: false }).limit(5),
      getEcoLeaderboard(20).then((data) => ({ data })).catch((error) => ({ error })),
      supabase.from('user_feedback').select('id, feedback_type, message, status, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
      getMyReliability().then((data) => ({ data })).catch(() => ({ data: null })),
      getImpactTotals().then((data) => ({ data })).catch(() => ({ data: null })),
    ]);
    const firstError = profileResult.error || contactResult.error || dealResult.error || listingResult.error || reviewResult.error || leaderboardResult.error || feedbackResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }
    const nextData = { userId, profile: profileResult.data || null, contacts: contactsToMap(contactResult.data || []), deals: dealResult.data || [], listings: listingResult.data || [], reviews: reviewResult.data || [], leaderboard: leaderboardResult.data || [], feedbackHistory: feedbackResult.data || [], reliability: reliabilityResult?.data || null, impact: impactResult?.data || null };
    if (profileResult.data) profileCache = nextData;
    setProfile(nextData.profile); setDeals(nextData.deals); setListings(nextData.listings); setReviews(nextData.reviews); setLeaderboard(nextData.leaderboard); setFeedbackHistory(nextData.feedbackHistory); setReliability(nextData.reliability); setImpact(nextData.impact);
    if (profileResult.data) {
      const nextLanguage = profileResult.data.preferred_language || profileResult.data.language || language;
      setForm({ full_name: profileResult.data.full_name || '', language: nextLanguage, contacts: nextData.contacts, ranking_opt_in: profileResult.data.ranking_opt_in ?? true });
    }
    setLoading(false);
  }, [language, userId]);

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
  const myRequests = useMemo(() => deals.filter((deal) => !deal.is_listing_owner && !deal.accepted_at && !deal.completed_at && !deal.canceled_at), [deals]);
  const reservations = useMemo(() => deals.filter((deal) => deal.accepted_at && !deal.completed_at && !deal.canceled_at), [deals]);
  const dealHistory = useMemo(() => deals.filter((deal) => deal.completed_at || deal.canceled_at), [deals]);
  const itemCount = completedDeals.reduce((sum, deal) => sum + Number(deal.quantity || 0), 0);
  const ecoPoints = Number(profile?.eco_points || 0);
  const levelState = getLevelProgress(ecoPoints);
  const levelIndex = levelState.currentIndex;
  const levels = t('profile.levels', { returnObjects: true });
  const nextThreshold = levelState.nextThreshold;
  const levelProgress = levelState.percent;
  const rawRating = Number(profile?.rating || 0);
  const rating = rawRating > 0 ? Math.max(1, rawRating - Number(profile?.rating_penalty || 0)) : 0;
  const achievements = [
    { label: t('profile.firstDeal'), icon: 'gift', unlocked: completedDeals.length >= 1 },
    { label: t('profile.fiveDeals'), icon: 'deals', unlocked: completedDeals.length >= 5 },
    { label: t('profile.fiftyItems'), icon: 'leaf', unlocked: itemCount >= 50 },
    { label: t('profile.topRating'), icon: 'star', unlocked: rating >= 4.8 && completedDeals.length > 0 },
  ];
  const levelMedals = LEVELS.map((level, index) => ({ ...level, label: levels[index], unlocked: index <= levelIndex }));

  const save = async () => {
    const validationError = validateContacts(form.contacts);
    if (validationError) return showToast(t(`contacts.${validationError}`), 'error');
    setSaving(true);
    try {
      await saveMyProfile({ ...form, full_name: form.full_name.trim() });
      await setRankingParticipation(Boolean(form.ranking_opt_in));
      setAppLanguage(form.language); setEditing(false); showToast(t('profile.saved'), 'success'); await load();
    } catch (saveError) { showToast(saveError.message === 'multi_messenger_migration_required' ? t('contacts.migrationRequired') : `${t('errors.save')} ${saveError.message}`, 'error'); }
    finally { setSaving(false); }
  };

  const deactivate = async (listingId) => {
    if (!window.confirm(t('profile.deactivateConfirm'))) return;
    setDeactivating(listingId);
    try {
      await deactivateListing(listingId);
      window.dispatchEvent(new Event('listings-updated'));
      await load();
    } catch (updateError) {
      showToast(updateError.message, 'error');
    } finally {
      setDeactivating(null);
    }
  };

  const changeAvatar = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) return showToast(t('workflow.avatarInvalid'), 'error');
    setAvatarSaving(true);
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${userId}/avatar.${extension}`;
      const { error: uploadError } = await supabase.storage.from('AVATARS').upload(path, file, { contentType: file.type, upsert: true, cacheControl: '3600' });
      if (uploadError) throw uploadError;
      const publicUrl = `${supabase.storage.from('AVATARS').getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
      await setMyAvatar(publicUrl);
      profileCache = null;
      await load();
      showToast(t('workflow.avatarSaved'), 'success');
    } catch (avatarError) {
      showToast(avatarError.message || t('errors.save'), 'error');
    } finally {
      setAvatarSaving(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarSaving(true);
    try {
      await setMyAvatar(null);
      profileCache = null;
      await load();
    } catch (avatarError) {
      showToast(avatarError.message || t('errors.save'), 'error');
    } finally {
      setAvatarSaving(false);
    }
  };

  const sendFeedback = async () => {
    if (feedback.message.trim().length < 5) return showToast(t('workflow.feedbackShort'), 'error');
    if (feedback.screenshot && (!['image/jpeg', 'image/png', 'image/webp'].includes(feedback.screenshot.type) || feedback.screenshot.size > 5 * 1024 * 1024)) return showToast(t('workflow.avatarInvalid'), 'error');
    setFeedbackSaving(true);
    try {
      let screenshotUrl = null;
      if (feedback.screenshot) {
        const extension = feedback.screenshot.name.split('.').pop()?.toLowerCase() || 'jpg';
        const path = `${userId}/feedback/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from('LISTING-PHOTOS').upload(path, feedback.screenshot, { contentType: feedback.screenshot.type, upsert: false });
        if (uploadError) throw uploadError;
        screenshotUrl = supabase.storage.from('LISTING-PHOTOS').getPublicUrl(path).data.publicUrl;
      }
      await createFeedback({ type: feedback.type, message: feedback.message.trim(), screenshotUrl });
      setFeedback({ type: 'feature', message: '', screenshot: null });
      profileCache = null;
      await load();
      showToast(t('workflow.feedbackSent'), 'success', { prominent: true });
    } catch (feedbackError) {
      showToast(feedbackError.message || t('errors.save'), 'error');
    } finally {
      setFeedbackSaving(false);
    }
  };

  if (loading) return <div className="app-screen grid min-h-screen place-items-center pb-28"><div className="state-card"><span className="spinner" />{t('common.loading')}</div></div>;
  if (error && !profile) return <div className="app-screen grid min-h-screen place-items-center px-5 pb-28"><div className="state-card"><Icon name="close" size={28} /><strong>{t('errors.load')}</strong><button type="button" className="btn-secondary" onClick={load}>{t('common.retry')}</button></div></div>;

  return (
    <div className="app-screen min-h-screen pb-28 pt-safe">
      <main className="app-container px-4 py-5">
        <section className="profile-hero">
          <div className="flex items-start justify-between gap-3"><div className="profile-avatar">{profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : profile?.full_name?.trim()?.charAt(0)?.toUpperCase() || 'V'}</div><button type="button" className="profile-edit" onClick={() => setEditing((value) => !value)} aria-label={t('profile.edit')}><Icon name={editing ? 'close' : 'edit'} size={19} /></button></div>
          <p className="eyebrow mt-5 text-white/65">{t('profile.eyebrow')}</p><h1 className="font-display mt-1 text-4xl text-white">{profile?.full_name}</h1>
          <div className="mt-5 grid grid-cols-2 gap-3"><div className="hero-stat"><small>{t('profile.ecoPoints')}</small><strong>{ecoPoints}</strong></div><div className="hero-stat"><small>{t('profile.rating')}</small><strong><Icon name="star" size={20} filled />{rating ? rating.toFixed(1) : '—'}</strong></div></div>
        </section>

        <section className="avatar-actions"><label className="btn-secondary cursor-pointer"><Icon name="camera" size={17} />{avatarSaving ? t('onboarding.saving') : t('workflow.changeAvatar')}<input type="file" className="hidden" accept="image/jpeg,image/png,image/webp" disabled={avatarSaving} onChange={changeAvatar} /></label>{profile?.avatar_url ? <button type="button" className="btn-link" disabled={avatarSaving} onClick={removeAvatar}>{t('workflow.removeAvatar')}</button> : null}</section>

        {editing ? <section className="card -mt-4 rounded-t-none p-5">
          <div className="space-y-4"><label className="block"><span className="field-label">{t('profile.name')}</span><input className="field" value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} /></label><label className="block"><span className="field-label">{t('profile.language')}</span><select className="field" value={form.language} onChange={(event) => setForm((current) => ({ ...current, language: event.target.value }))}><option value="me">Crnogorski</option><option value="ru">Русский</option><option value="en">English</option></select></label><ContactChannelsFields contacts={form.contacts} onChange={(contacts) => setForm((current) => ({ ...current, contacts }))} t={t} /><label className="ranking-toggle"><input type="checkbox" checked={Boolean(form.ranking_opt_in)} onChange={(event) => setForm((current) => ({ ...current, ranking_opt_in: event.target.checked }))} /><span><strong>{t('profile.rankingParticipation')}</strong><small>{t('profile.rankingPrivacy')}</small></span></label><button type="button" className="btn-primary w-full" disabled={saving} onClick={save}>{saving ? t('onboarding.saving') : t('common.save')}</button></div>
        </section> : null}

        <section className="impact-grid mt-4"><div className="impact-card"><span><Icon name="deals" size={21} /></span><strong>{completedDeals.length}</strong><small>{t('profile.deals')}</small></div><div className="impact-card"><span><Icon name="leaf" size={21} /></span><strong>{itemCount}</strong><small>{t('profile.items')}</small></div></section>
        {impact ? <section className="card mt-4 p-5"><div className="section-head"><div><p className="eyebrow text-sea">VratiMe</p><h2 className="font-display mt-1 text-2xl text-forest">{t('impact.title', 'Повторное использование')}</h2></div><Icon name="leaf" size={24} /></div><div className="mt-4 grid grid-cols-2 gap-2"><div className="impact-card"><strong>{impact.personal?.items ?? 0}</strong><small>{t('impact.personalItems', 'Мои вещи')}</small></div><div className="impact-card"><strong>{impact.community?.items ?? 0}</strong><small>{t('impact.communityItems', 'Всего в сообществе')}</small></div><div className="impact-card"><strong>{Number(impact.personal?.declared_weight_kg || 0).toLocaleString(language)}</strong><small>{t('impact.declaredKg', 'Заявлено кг')}</small></div><div className="impact-card"><strong>{Object.keys(impact.personal?.categories || {}).length}</strong><small>{t('impact.categories', 'Категории')}</small></div></div><p className="mt-3 text-xs font-semibold text-muted">{t('impact.noCo2', 'Показываем только вещи и заявленный вес. CO₂ не рассчитывается без утверждённой методики.')}</p></section> : null}

        <section className="card mt-4 p-5"><div className="flex items-center justify-between"><div><p className="eyebrow text-sea">{t('profile.level')}</p><h2 className="font-display mt-1 text-2xl text-forest">{levels[levelIndex]}</h2></div><span className="level-emblem" style={{ '--level-progress': `${levelProgress}%` }}><img src={logo} alt="" /><b>{levelIndex + 1}</b></span></div><div className="level-track mt-5"><span style={{ width: `${levelProgress}%` }} /></div><div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs font-semibold text-muted">{nextThreshold ? t('profile.nextLevel', { count: levelState.remaining }) : t('profile.maxLevel')}</p><button type="button" className="btn-link text-xs" onClick={() => setLevelsOpen(true)}>{t('profile.allLevels')}</button></div><div className="level-medals-preview mt-4">{levelMedals.map((medal, index) => <span key={medal.id} className={`level-medal ${medal.unlocked ? 'unlocked' : ''}`} title={`${medal.label} · ${medal.threshold}`}><Icon name={medal.icon} size={18} /><b>{index + 1}</b></span>)}</div></section>

        <section className="card mt-4 p-5"><div className="section-head"><div><p className="eyebrow text-sea">VratiMe</p><h2 className="font-display mt-1 text-2xl text-forest">Надёжность</h2></div><Icon name="handshake" size={24} /></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="impact-card"><strong>{reliability?.completed_count ?? 0}</strong><small>завершено</small></div><div className="impact-card"><strong>{reliability?.accepted_cancellations ?? 0}</strong><small>отмены</small></div><div className="impact-card"><strong>{reliability?.confirmed_no_shows_90d ?? 0}</strong><small>no-show 90д</small></div></div><p className="mt-3 text-xs font-semibold text-muted">No-show не снижает рейтинг автоматически. Он становится сигналом только после подтверждения или решения модератора.</p></section>

        <SupportFund />

        <section className="card mt-4 p-5"><div className="section-head"><div><p className="eyebrow text-sea">VratiMe</p><h2 className="font-display mt-1 text-2xl text-forest">{t('profile.pointsWhy')}</h2></div><span className="icon-tile"><Icon name="leaf" size={21} /></span></div><p className="mt-3 text-sm leading-6 text-muted">{t('profile.pointsIntro')}</p><ul className="mt-4 space-y-3 text-sm font-semibold leading-5 text-forest"><li className="flex gap-2"><Icon name="check" size={17} />{t('profile.pointsEarn')}</li><li className="flex gap-2"><Icon name="check" size={17} />{t('profile.pointsLevels')}</li><li className="flex gap-2"><Icon name="check" size={17} />{t('profile.pointsNoMoney')}</li></ul></section>

        <section className="card mt-4 p-5"><div className="section-head"><div><p className="eyebrow text-sea">VratiMe</p><h2 className="font-display mt-1 text-2xl text-forest">{t('profile.achievements')}</h2></div><Icon name="award" size={24} /></div><div className="mt-4 grid grid-cols-4 gap-2">{achievements.map((item) => <div key={item.label} className={`achievement ${item.unlocked ? 'unlocked' : ''}`}><span className="achievement-mark"><Icon name={item.icon} size={22} filled={item.icon === 'star'} /></span><span>{item.label}</span></div>)}</div></section>

        <section className="card mt-4 p-5"><div className="section-head"><div><p className="eyebrow text-sea">VratiMe</p><h2 className="font-display mt-1 text-2xl text-forest">{t('profile.leaderboard')}</h2></div><Icon name="award" size={24} /></div><p className="mt-2 text-sm leading-6 text-muted">{t('profile.leaderboardText')}</p>{leaderboard.length ? <div className="leaderboard mt-4">{leaderboard.map((entry) => <div key={entry.user_id} className={`leaderboard-row ${entry.user_id === userId ? 'is-me' : ''}`}><b>{entry.rank}</b><span>{entry.full_name}</span><strong>{entry.eco_points}</strong></div>)}</div> : <p className="empty-copy mt-4">{t('profile.leaderboardEmpty')}</p>}</section>

        <section className="card mt-4 p-5"><div className="section-head"><h2 className="font-display text-2xl text-forest">{t('profile.listings')}</h2><span className="count-pill">{listings.length}</span></div>{listings.length ? <div className="mt-4 space-y-3">{listings.map((listing) => <article key={listing.id} className="profile-listing">{listing.image_url ? <img src={listing.image_url} alt="" /> : <span><CategoryIcon category={listing} size={24} /></span>}<div className="min-w-0 flex-1"><strong>{listingCategoryLabel(listing, language)}</strong><small>{t('common.pieces', { count: listing.quantity })} · доступно: {listing.available_quantity ?? listing.quantity} · бронь: {listing.reserved_quantity ?? 0} · {t(`status.${listing.status}`)} · {t(`moderation.${listing.moderation_status || 'approved'}`)}</small></div><button type="button" className="icon-button" onClick={() => onEditListing?.(listing)} aria-label={t('profile.editListing')}><Icon name="edit" size={17} /></button>{listing.status === 'active' ? <button type="button" className="icon-button danger" disabled={deactivating === listing.id} onClick={() => deactivate(listing.id)} aria-label={t('profile.deactivate')}><Icon name="close" size={17} /></button> : null}</article>)}</div> : <p className="empty-copy mt-4">{t('profile.noListings')}</p>}</section>

        <ProfileDealSection title={t('workflow.myRequests')} deals={myRequests} language={language} t={t} />
        <ProfileDealSection title={t('workflow.myReservations')} deals={reservations} language={language} t={t} />
        <ProfileDealSection title={t('workflow.myHistory')} deals={dealHistory} language={language} t={t} />

        <section className="card feedback-card mt-4 p-5"><div className="section-head"><div><p className="eyebrow text-sea">VratiMe</p><h2 className="font-display text-2xl text-forest">{t('workflow.ideaTitle')}</h2></div><span className="icon-tile"><Icon name="message" size={21} /></span></div><p className="mt-2 text-sm text-muted">{t('workflow.ideaText')}</p><label className="mt-4 block"><span className="field-label">{t('workflow.feedbackType')}</span><select className="field" value={feedback.type} onChange={(event) => setFeedback((current) => ({ ...current, type: event.target.value }))}><option value="feature">{t('workflow.feedbackFeature')}</option><option value="category">{t('workflow.feedbackCategory')}</option><option value="problem">{t('workflow.feedbackProblem')}</option><option value="support">{t('workflow.feedbackSupport')}</option></select></label><label className="mt-4 block"><span className="field-label">{t('workflow.message')}</span><textarea className="field min-h-28 resize-y py-3" maxLength={3000} value={feedback.message} onChange={(event) => setFeedback((current) => ({ ...current, message: event.target.value }))} /></label><label className="btn-secondary mt-4 cursor-pointer"><Icon name="camera" size={17} />{feedback.screenshot ? feedback.screenshot.name : t('workflow.addScreenshot')}<input type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFeedback((current) => ({ ...current, screenshot: event.target.files?.[0] || null }))} /></label><button type="button" className="btn-primary mt-4 w-full" disabled={feedbackSaving} onClick={sendFeedback}>{feedbackSaving ? t('onboarding.saving') : t('workflow.send')}</button>{feedbackHistory.length ? <div className="feedback-history mt-5">{feedbackHistory.map((item) => <article key={item.id}><strong>{t(`workflow.feedback${item.feedback_type.charAt(0).toUpperCase()}${item.feedback_type.slice(1)}`)}</strong><span>{t(`feedbackStatus.${item.status}`)}</span><p>{item.message}</p></article>)}</div> : null}</section>

        {['moderator', 'admin'].includes(profile?.app_role) ? <StaffPanel role={profile.app_role} /> : null}

        <section className="card mt-4 p-5"><h2 className="font-display text-2xl text-forest">{t('profile.reviews')}</h2>{reviews.length ? <div className="mt-4 space-y-3">{reviews.map((review) => <article key={review.id} className="review-row"><div><strong>{review.from_user?.full_name || t('common.partner')}</strong><small>{new Date(review.created_at).toLocaleDateString(language === 'me' ? 'sr-ME' : language)}</small></div><span><Icon name="star" size={17} filled />{Number(review.rating).toFixed(1)}</span></article>)}</div> : <p className="empty-copy mt-4">{t('profile.noReviews')}</p>}</section>
        <button type="button" className="btn-ghost mt-4 w-full" onClick={() => supabase.auth.signOut()}><Icon name="logout" size={19} />{t('profile.logout')}</button>
      </main>
      {levelsOpen ? <div className="modal-backdrop grid place-items-end sm:place-items-center p-0 sm:p-5"><section className="levels-dialog" role="dialog" aria-modal="true" aria-label={t('profile.allLevels')}><div className="flex items-start justify-between gap-3"><div><p className="eyebrow text-sea">VratiMe</p><h2 className="font-display mt-1 text-2xl text-forest">{t('profile.allLevels')}</h2><p className="mt-2 text-sm text-muted">{t('profile.levelsProgress', { count: levelIndex + 1, total: levels.length })}</p></div><button type="button" className="icon-button" onClick={() => setLevelsOpen(false)} aria-label={t('common.close')}><Icon name="close" size={18} /></button></div><div className="levels-catalog mt-5">{levelMedals.map((medal, index) => <article key={medal.id} className={`levels-catalog-item ${medal.unlocked ? 'unlocked' : ''}`}><span className="level-medal"><Icon name={medal.icon} size={23} /><b>{index + 1}</b></span><div><strong>{medal.label}</strong><small>{t('profile.levelAt', { count: medal.threshold })}</small></div>{medal.unlocked ? <Icon name="check" size={20} /> : <Icon name="lock" size={20} />}</article>)}</div></section></div> : null}
    </div>
  );
}
