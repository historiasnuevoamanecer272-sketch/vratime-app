import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';
import { getAppLanguage, setAppLanguage } from '../i18n';
import { saveMyProfile } from '../lib/api';
import { showToast } from '../lib/toast';
import Icon from '../components/Icon';

export default function Onboarding({ onComplete }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ full_name: '', language: getAppLanguage(), messenger_type: 'viber', contact_value: '' });

  useEffect(() => {
    let active = true;
    const prefill = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const { data } = await supabase.from('profiles').select('full_name, language, preferred_language').eq('id', userData.user.id).maybeSingle();
      if (!active || !data) return;
      const language = data.preferred_language || data.language || getAppLanguage();
      setForm((current) => ({ ...current, full_name: data.full_name || current.full_name, language }));
      setAppLanguage(language);
    };
    const initialLoad = window.setTimeout(prefill, 0);
    return () => { active = false; window.clearTimeout(initialLoad); };
  }, []);

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === 'language') setAppLanguage(value);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      await saveMyProfile({ ...form, full_name: form.full_name.trim(), contact_value: form.contact_value.trim() });
      onComplete();
    } catch (error) {
      showToast(`${t('errors.save')} ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-screen min-h-screen px-5 py-7 pt-safe">
      <main className="app-container max-w-md">
        <section className="card overflow-hidden">
          <div className="onboarding-hero">
            <span className="icon-tile icon-tile-light"><Icon name="user" size={25} /></span>
            <p className="eyebrow mt-5 text-white/70">{t('onboarding.eyebrow')}</p>
            <h1 className="font-display mt-2 text-4xl text-white">{t('onboarding.title')}</h1>
            <p className="mt-3 max-w-sm text-sm font-medium leading-6 text-white/75">{t('onboarding.text')}</p>
          </div>
          <form className="space-y-4 p-5" onSubmit={handleSave}>
            <label className="block"><span className="field-label">{t('onboarding.name')}</span><input className="field" type="text" value={form.full_name} onChange={(event) => update('full_name', event.target.value)} placeholder={t('onboarding.namePlaceholder')} autoComplete="name" required minLength={2} /></label>
            <label className="block"><span className="field-label">{t('onboarding.language')}</span><select className="field" value={form.language} onChange={(event) => update('language', event.target.value)}><option value="me">Crnogorski</option><option value="ru">Русский</option><option value="en">English</option></select></label>
            <label className="block"><span className="field-label">{t('onboarding.messenger')}</span><select className="field" value={form.messenger_type} onChange={(event) => update('messenger_type', event.target.value)}><option value="viber">Viber</option><option value="wa">WhatsApp</option><option value="tg">Telegram</option></select></label>
            <label className="block"><span className="field-label">{t('onboarding.contact')}</span><input className="field" type="text" value={form.contact_value} onChange={(event) => update('contact_value', event.target.value)} placeholder={t('onboarding.contactPlaceholder')} autoComplete="tel" required minLength={3} /></label>
            <button type="submit" className="btn-primary mt-2 w-full" disabled={loading}><Icon name="check" size={19} />{loading ? t('onboarding.saving') : t('onboarding.submit')}</button>
          </form>
        </section>
      </main>
    </div>
  );
}
