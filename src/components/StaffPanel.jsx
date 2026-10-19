import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';
import { moderateListing, resolveReport, setFeedbackStatus, setUserRole } from '../lib/api';
import { showToast } from '../lib/toast';
import Icon from './Icon';
import PrivateMediaAttachment from './PrivateMediaAttachment';
import { friendlyError } from '../lib/userErrors';

export default function StaffPanel({ role }) {
  const { t } = useTranslation();
  const [data, setData] = useState({ listings: [], reports: [], feedback: [], profiles: [] });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [reasons, setReasons] = useState({});
  const [reasonErrors, setReasonErrors] = useState({});
  const actionMutex = useRef(false);
  const isStaff = role === 'moderator' || role === 'admin';

  const load = useCallback(async () => {
    if (!['moderator', 'admin'].includes(role)) return;
    setLoading(true);
    try {
    const requests = [
      supabase.from('listings').select('id, category, category_path, description, location_label, user_id, created_at, status, moderation_status').eq('status', 'active').in('moderation_status', ['pending', 'approved']).order('created_at', { ascending: false }),
      supabase.from('reports').select('*').in('status', ['open', 'reviewing']).order('created_at'),
      supabase.from('user_feedback').select('*').neq('status', 'closed').order('created_at'),
    ];
    if (role === 'admin') requests.push(supabase.from('profiles').select('id, full_name, app_role').order('full_name'));
    const [listings, reports, feedback, profiles] = await Promise.all(requests);
    const firstError = listings.error || reports.error || feedback.error || profiles?.error;
    if (firstError) { showToast(friendlyError(firstError, t), 'error'); return; }
    setData({ listings: listings.data || [], reports: reports.data || [], feedback: feedback.data || [], profiles: profiles?.data || [] });
    } catch (error) { showToast(friendlyError(error, t), 'error'); }
    finally { setLoading(false); }
  }, [role, t]);

  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load]);

  const act = async (key, operation, refreshListings = false) => {
    if (!isStaff || actionMutex.current) return;
    actionMutex.current = true;
    setWorking(key);
    try { await operation(); if (refreshListings) window.dispatchEvent(new Event('listings-updated')); await load(); showToast(t('workflow.staffSaved'), 'success'); }
    catch (error) { showToast(friendlyError(error, t), 'error'); }
    finally { actionMutex.current = false; setWorking(''); }
  };

  const moderate = (listing, decision) => {
    const reason = (reasons[listing.id] || '').trim();
    if (decision === 'rejected' && reason.length < 3) {
      setReasonErrors((current) => ({ ...current, [listing.id]: true }));
      return;
    }
    if (decision === 'approved' && listing.moderation_status !== 'pending') return;
    return act(listing.id, () => moderateListing(listing.id, decision, decision === 'rejected' ? reason : null), true);
  };

  if (!isStaff) return null;
  if (loading) return <section className="card mt-4 p-5"><span className="spinner" />{t('common.loading')}</section>;
  return <section className="card staff-panel mt-4 p-5"><div className="section-head"><div><p className="eyebrow text-sea">{t('workflow.staff')}</p><h2 className="font-display text-2xl text-forest">{t('staffExperience.title')}</h2></div><button type="button" className="icon-button" disabled={Boolean(working)} onClick={load} aria-label={t('map.refresh')}><Icon name="refresh" size={17} /></button></div>
    <p className="empty-copy mt-3">{t('staffExperience.description')}</p>
    <h3>{t('staffExperience.listings')} · {data.listings.length}</h3>
    <div className="staff-list">{data.listings.map((listing) => <article key={listing.id}><strong>{listing.category}</strong><small>{listing.location_label}</small><p>{listing.description}</p><label><span className="field-label">{t('staffExperience.reason')}</span><textarea className="field min-h-20 py-2" minLength={3} disabled={Boolean(working)} aria-invalid={Boolean(reasonErrors[listing.id])} aria-describedby={`staff-reason-${listing.id}`} value={reasons[listing.id] || ''} onChange={(event) => { setReasons((current) => ({ ...current, [listing.id]: event.target.value })); setReasonErrors((current) => ({ ...current, [listing.id]: false })); }} /></label><small id={`staff-reason-${listing.id}`} className={reasonErrors[listing.id] ? 'field-error' : 'address-hint'}>{t(reasonErrors[listing.id] ? 'staffExperience.reasonRequired' : 'staffExperience.reasonHint')}</small><div className="staff-actions">{listing.moderation_status === 'pending' ? <button type="button" className="btn-primary" disabled={Boolean(working)} onClick={() => moderate(listing, 'approved')}>{t('workflow.approve')}</button> : null}<button type="button" className="btn-ghost" disabled={Boolean(working) || (reasons[listing.id] || '').trim().length < 3} onClick={() => moderate(listing, 'rejected')}>{t(listing.moderation_status === 'approved' ? 'staffExperience.withdraw' : 'workflow.reject')}</button></div></article>)}</div>
    <h3>{t('workflow.reportQueue')} · {data.reports.length}</h3>
    <div className="staff-list">{data.reports.map((report) => <article key={report.id}><strong>{report.target_kind} · {report.reason}</strong><p>{report.details}</p><div className="staff-actions"><button type="button" className="btn-secondary" disabled={Boolean(working)} onClick={() => act(report.id, () => resolveReport(report.id, 'dismissed', 0))}>{t('workflow.dismiss')}</button>{[0, 0.5, 1].map((penalty) => <button key={penalty} type="button" className="btn-primary" disabled={Boolean(working)} onClick={() => act(report.id, () => resolveReport(report.id, 'upheld', penalty))}>{t('workflow.uphold')} {penalty}</button>)}</div></article>)}</div>
    <h3>{t('workflow.supportQueue')} · {data.feedback.length}</h3>
    <div className="staff-list">{data.feedback.map((item) => <article key={item.id}><strong>{item.feedback_type}</strong><p>{item.message}</p>{item.screenshot_url ? <PrivateMediaAttachment reference={item.screenshot_url} userId={item.user_id} /> : null}<select className="field mt-3" value={item.status} disabled={Boolean(working)} onChange={(event) => act(item.id, () => setFeedbackStatus(item.id, event.target.value))}>{['received', 'reviewing', 'planned', 'resolved', 'closed'].map((status) => <option key={status} value={status}>{t(`feedbackStatus.${status}`)}</option>)}</select></article>)}</div>
    {role === 'admin' ? <><h3>{t('workflow.roles')}</h3><div className="staff-list">{data.profiles.map((person) => <article key={person.id}><strong>{person.full_name || person.id}</strong><small>{person.id}</small><select className="field mt-3" value={person.app_role || 'user'} disabled={Boolean(working)} onChange={(event) => act(person.id, () => setUserRole(person.id, event.target.value))}>{['user', 'moderator', 'admin'].map((nextRole) => <option key={nextRole} value={nextRole}>{t(`roles.${nextRole}`)}</option>)}</select></article>)}</div></> : null}
  </section>;
}
