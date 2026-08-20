import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';
import { getAppLanguage, setAppLanguage } from '../i18n';
import { saveMyProfile } from '../lib/api';
import { contactsToMap, emptyContactMap, validateContacts } from '../lib/contacts';
import { showToast } from '../lib/toast';
import Icon from '../components/Icon';
import ContactChannelsFields from '../components/ContactChannelsFields';

export default function Onboarding({ userId, onComplete }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ full_name: '', language: getAppLanguage(), contacts: emptyContactMap() });

  useEffect(() => {
    let active = true;
    const prefill = async () => {
      const [profileResult, contactResult] = await Promise.all([
        supabase.from('profiles').select('full_name, language, preferred_language').eq('id', userId).maybeSingle(),
        supabase.from('profile_contacts').select('messenger_type, contact_value').eq('user_id', userId),
      ]);
      if (!active || !profileResult.data) return;
      const language = profileResult.data.preferred_language || profileResult.data.language || getAppLanguage();
      setForm((current) => ({
        ...current,
        full_name: profileResult.data.full_name || current.full_name,
        language,
        contacts: contactResult.data?.length ? contactsToMap(contactResult.data) : current.contacts,
      }));
      setAppLanguage(language);
    };
    const initialLoad = window.setTimeout(prefill, 0);
    return () => { active = false; window.clearTimeout(initialLoad); };
  }, [userId]);

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === 'language') setAppLanguage(value);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    const validationError = validateContacts(form.contacts);
    if (validationError) return showToast(t(`contacts.${validationError}`), 'error');
    setLoading(true);
    try {
      await saveMyProfile({ ...form, full_name: form.full_name.trim() });
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
            <ContactChannelsFields contacts={form.contacts} onChange={(contacts) => update('contacts', contacts)} t={t} />
            <button type="submit" className="btn-primary mt-2 w-full" disabled={loading}><Icon name="check" size={19} />{loading ? t('onboarding.saving') : t('onboarding.submit')}</button>
          </form>
        </section>
      </main>
    </div>
  );
}
