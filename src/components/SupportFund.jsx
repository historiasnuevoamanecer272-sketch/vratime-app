import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getFundingProgress } from '../lib/api';
import { getAppLanguage } from '../i18n';
import Icon from './Icon';

const percent = (value, target) => target > 0 ? Math.min(100, Math.max(0, Math.round((value / target) * 100))) : 0;

export default function SupportFund({ page = false }) {
  const { t } = useTranslation();
  const language = getAppLanguage();
  const [fund, setFund] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await getFundingProgress();
      setFund(data);
    } catch (error) {
      console.error('Funding progress failed:', error);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(load, 0);
    const refreshTimer = window.setInterval(load, 60_000);
    const refreshVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(refreshTimer);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [load]);

  const locale = language === 'me' ? 'sr-Latn-ME' : language;
  const formatter = useMemo(() => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 }), [locale]);
  const monthlyTarget = Number(fund?.monthly_target_eur_cents || 5000);
  const annualTarget = Number(fund?.annual_target_eur_cents || 60000);
  const monthCovered = Number(fund?.month_covered_eur_cents || 0);
  const yearCollected = Number(fund?.year_collected_eur_cents || 0);
  const reserve = Number(fund?.reserve_eur_cents || 0);
  const monthPercent = percent(monthCovered, monthlyTarget);
  const yearPercent = percent(yearCollected, annualTarget);
  const money = (cents) => formatter.format(cents / 100);
  const contributionDate = fund?.last_contribution_at ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(fund.last_contribution_at)) : null;

  return (
    <section className={`support-fund ${page ? 'support-fund-page' : 'card mt-4'}`} aria-labelledby={page ? 'support-page-title' : 'support-card-title'}>
      <div className="support-fund-head">
        <span className="support-heart"><Icon name="heart" size={23} /></span>
        <div>
          <p className="eyebrow text-sea">VratiMe</p>
          <h2 id={page ? 'support-page-title' : 'support-card-title'} className="font-display text-2xl text-forest">{t('support.title')}</h2>
        </div>
      </div>
      <p className="support-fund-copy">{t('support.text', { amount: money(monthlyTarget) })}</p>

      <div className="support-goals">
        <div className="support-goal">
          <div className="support-goal-label"><span>{t('support.monthGoal')}</span><strong>{monthPercent}%</strong></div>
          <div className="support-track" role="progressbar" aria-label={t('support.monthGoal')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={monthPercent}><span style={{ width: `${monthPercent}%` }} /></div>
          <p>{money(monthCovered)} {t('support.of')} {money(monthlyTarget)}</p>
        </div>
        <div className="support-goal">
          <div className="support-goal-label"><span>{t('support.yearGoal', { year: new Date().getFullYear() })}</span><strong>{yearPercent}%</strong></div>
          <div className="support-track support-track-year" role="progressbar" aria-label={t('support.yearGoal', { year: new Date().getFullYear() })} aria-valuemin="0" aria-valuemax="100" aria-valuenow={yearPercent}><span style={{ width: `${yearPercent}%` }} /></div>
          <p>{money(yearCollected)} {t('support.of')} {money(annualTarget)}</p>
        </div>
      </div>

      {reserve > 0 ? <div className="support-reserve"><Icon name="check" size={18} /><span>{t('support.reserve', { amount: money(reserve), count: Number(fund?.reserved_months || 0).toLocaleString(locale, { maximumFractionDigits: 1 }) })}</span></div> : null}
      <div className="support-meta">
        <span>{t('support.supporters', { count: Number(fund?.supporters_count || 0) })}</span>
        {contributionDate ? <span>{t('support.updated', { date: contributionDate })}</span> : <span>{t('support.empty')}</span>}
      </div>

      {fund?.enabled && fund?.tribute_url ? <a className="btn-primary support-action" href={fund.tribute_url} target="_blank" rel="noopener noreferrer"><Icon name="heart" size={19} />{t('support.action')}</a> : <button type="button" className="btn-primary support-action" disabled><Icon name="heart" size={19} />{t('support.soon')}</button>}
      <p className="support-note">{t('support.netNote')}</p>
    </section>
  );
}
