import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';
import { moderateListing, resolveReport, setFeedbackStatus, setUserRole } from '../lib/api';
import { showToast } from '../lib/toast';
import Icon from './Icon';

export default function StaffPanel({ role }) {
  const { t } = useTranslation();
  const [data, setData] = useState({ listings: [], reports: [], feedback: [], profiles: [] });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [reasons, setReasons] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    const requests = [
      supabase.from('listings').select('id, category, category_path, description, location_label, user_id, created_at').eq('moderation_status', 'pending').order('created_at'),
      supabase.from('reports').select('*').in('status', ['open', 'reviewing']).order('created_at'),
      supabase.from('user_feedback').select('*').neq('status', 'closed').order('created_at'),
    ];
    if (role === 'admin') requests.push(supabase.from('profiles').select('id, full_name, app_role').order('full_name'));
    const [listings, reports, feedback, profiles] = await Promise.all(requests);
    const firstError = listings.error || reports.error || feedback.error || profiles?.error;
    if (firstError) showToast(firstError.message || t('errors.load'), 'error');
    setData({ listings: listings.data || [], reports: reports.data || [], feedback: feedback.data || [], profiles: profiles?.data || [] });
    setLoading(false);
  }, [role, t]);

  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load]);

  const act = async (key, operation) => {
    setWorking(key);
    try { await operation(); await load(); showToast(t('workflow.staffSaved'), 'success'); }
    catch (error) { showToast(error.message || t('errors.save'), 'error'); }
    finally { setWorking(''); }
  };

  if (loading) return <section className="card mt-4 p-5"><span className="spinner" />{t('common.loading')}</section>;
  return <section className="card staff-panel mt-4 p-5"><div className="section-head"><div><p className="eyebrow text-sea">{t('workflow.staff')}</p><h2 className="font-display text-2xl text-forest">{t('workflow.staffQueue')}</h2></div><button type="button" className="icon-button" onClick={load} aria-label={t('map.refresh')}><Icon name="refresh" size={17} /></button></div>
    <h3>{t('workflow.moderationQueue')} · {data.listings.length}</h3>
    <div className="staff-list">{data.listings.map((listing) => <article key={listing.id}><strong>{listing.category}</strong><small>{listing.location_label}</small><p>{listing.description}</p><textarea className="field min-h-20 py-2" placeholder={t('workflow.rejectionReason')} value={reasons[listing.id] || ''} onChange={(event) => setReasons((current) => ({ ...current, [listing.id]: event.target.value }))} /><div className="staff-actions"><button type="button" className="btn-primary" disabled={working === listing.id} onClick={() => act(listing.id, () => moderateListing(listing.id, 'approved'))}>{t('workflow.approve')}</button><button type="button" className="btn-ghost" disabled={working === listing.id || (reasons[listing.id] || '').trim().length < 3} onClick={() => act(listing.id, () => moderateListing(listing.id, 'rejected', reasons[listing.id]))}>{t('workflow.reject')}</button></div></article>)}</div>
    <h3>{t('workflow.reportQueue')} · {data.reports.length}</h3>
    <div className="staff-list">{data.reports.map((report) => <article key={report.id}><strong>{report.target_kind} · {report.reason}</strong><p>{report.details}</p><div className="staff-actions"><button type="button" className="btn-secondary" disabled={working === report.id} onClick={() => act(report.id, () => resolveReport(report.id, 'dismissed', 0))}>{t('workflow.dismiss')}</button>{[0, 0.5, 1].map((penalty) => <button key={penalty} type="button" className="btn-primary" disabled={working === report.id} onClick={() => act(report.id, () => resolveReport(report.id, 'upheld', penalty))}>{t('workflow.uphold')} {penalty}</button>)}</div></article>)}</div>
    <h3>{t('workflow.supportQueue')} · {data.feedback.length}</h3>
    <div className="staff-list">{data.feedback.map((item) => <article key={item.id}><strong>{item.feedback_type}</strong><p>{item.message}</p>{item.screenshot_url ? <a href={item.screenshot_url} target="_blank" rel="noreferrer">{t('workflow.screenshot')}</a> : null}<select className="field mt-3" value={item.status} disabled={working === item.id} onChange={(event) => act(item.id, () => setFeedbackStatus(item.id, event.target.value))}>{['received', 'reviewing', 'planned', 'resolved', 'closed'].map((status) => <option key={status} value={status}>{t(`feedbackStatus.${status}`)}</option>)}</select></article>)}</div>
    {role === 'admin' ? <><h3>{t('workflow.roles')}</h3><div className="staff-list">{data.profiles.map((person) => <article key={person.id}><strong>{person.full_name || person.id}</strong><small>{person.id}</small><select className="field mt-3" value={person.app_role || 'user'} disabled={working === person.id} onChange={(event) => act(person.id, () => setUserRole(person.id, event.target.value))}>{['user', 'moderator', 'admin'].map((nextRole) => <option key={nextRole} value={nextRole}>{t(`roles.${nextRole}`)}</option>)}</select></article>)}</div></> : null}
  </section>;
}
