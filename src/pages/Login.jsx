import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';
import { getAppLanguage, setAppLanguage } from '../i18n';
import { showToast } from '../lib/toast';
import logo from '../assets/images/app-logo.png';
import Icon from '../components/Icon';

const languages = [{ id: 'ru', label: 'RU' }, { id: 'me', label: 'ME' }, { id: 'en', label: 'EN' }];

export default function Login() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sentEmail, setSentEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`;
  const googleEnabled = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === 'true';

  const sendMagicLink = async (event) => {
    event?.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return showToast(t('auth.invalid'), 'error');
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ email: normalized, options: { emailRedirectTo: redirectTo } });
    setLoading(false);
    if (error) {
      showToast(error.status === 429 ? t('auth.rateLimit') : error.message, 'error');
      return;
    }
    setSentEmail(normalized);
  };

  const continueWithGoogle = async () => {
    if (!googleEnabled) return showToast(t('auth.googleUnavailable'), 'info');
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) { showToast(error.message, 'error'); setLoading(false); }
  };

  return (
    <div className="auth-screen app-screen min-h-screen px-5 py-5 pt-safe">
      <main className="auth-container flex min-h-[calc(100svh-2.5rem)] flex-col justify-center">
        <div className="mb-5 flex justify-end gap-1" aria-label="Language">
          {languages.map((language) => <button key={language.id} type="button" className={`language-chip ${getAppLanguage() === language.id ? 'active' : ''}`} onClick={() => setAppLanguage(language.id)}>{language.label}</button>)}
        </div>

        <section className="auth-card">
          <div className="auth-hero">
            <div className="auth-mark"><img src={logo} alt="VratiMe" /></div>
            <p className="eyebrow text-sea"><Icon name="leaf" size={14} />{t('auth.eyebrow')}</p>
            <h1 className="font-display mt-3 text-[2.65rem] leading-[1.02] text-forest">{t('auth.title')}</h1>
            <p className="mt-4 text-[0.94rem] font-medium leading-6 text-muted">{t('auth.subtitle')}</p>
          </div>

          {sentEmail ? (
            <div className="auth-form text-center" aria-live="polite">
              <span className="success-orb mx-auto"><Icon name="mail" size={30} /></span>
              <h2 className="font-display mt-5 text-2xl text-forest">{t('auth.sentTitle')}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{t('auth.sentText', { email: sentEmail })}</p>
              <p className="mt-3 rounded-2xl bg-paper-deep px-4 py-3 text-xs font-semibold text-muted">{t('auth.spam')}</p>
              <button type="button" className="btn-primary mt-5 w-full" disabled={loading} onClick={sendMagicLink}>{loading ? t('auth.sending') : t('auth.resend')}</button>
              <button type="button" className="btn-link mt-4" onClick={() => setSentEmail('')}>{t('auth.another')}</button>
            </div>
          ) : (
            <form className="auth-form" onSubmit={sendMagicLink}>
              <label className="field-label" htmlFor="login-email">{t('auth.email')}</label>
              <div className="field-with-icon"><Icon name="mail" size={19} /><input id="login-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" autoComplete="email" inputMode="email" autoCapitalize="none" className="field" required /></div>
              <button type="submit" className="btn-primary mt-4 w-full" disabled={loading}><Icon name="arrowRight" size={19} />{loading ? t('auth.sending') : t('auth.magic')}</button>
              <div className="auth-divider"><span>{t('auth.divider')}</span></div>
              <button type="button" className="btn-google w-full" disabled={loading} onClick={continueWithGoogle}><span className="google-g">G</span>{t('auth.google')}</button>
              <p className="mt-4 text-center text-xs font-medium leading-5 text-muted">{t('auth.hint')}</p>
            </form>
          )}
        </section>
        <p className="mt-5 text-center text-xs font-bold tracking-wide text-muted">VratiMe · NVO LUNA</p>
      </main>
    </div>
  );
}
