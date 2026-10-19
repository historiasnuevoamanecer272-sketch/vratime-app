import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';
import { getAppLanguage, setAppLanguage } from '../i18n';
import { showToast } from '../lib/toast';
import { createGoogleSignInRequest } from '../lib/authNavigation';
import logo from '../assets/images/app-logo.png';
import montenegroHero from '../assets/visuals/v2/montenegro-adriatic-hero-v1.webp';
import Icon from '../components/Icon';
import LanguageMenu from '../components/LanguageMenu';

export default function Login() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`;

  const continueWithGoogle = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth(createGoogleSignInRequest(redirectTo));
    if (error) { showToast(error.message, 'error'); setLoading(false); }
  };

  return (
    <div className="auth-screen app-screen min-h-screen px-5 py-5 pt-safe">
      <main className="auth-container flex min-h-[calc(100svh-2.5rem)] flex-col justify-center">
        <div className="mb-5 flex justify-end">
          <LanguageMenu value={getAppLanguage()} onChange={setAppLanguage} label={t('profile.language')} />
        </div>

        <section className="auth-card">
          <div className="auth-hero">
            <div className="auth-mark"><img src={logo} alt="VratiMe" /></div>
            <p className="eyebrow text-sea"><Icon name="leaf" size={14} />{t('auth.eyebrow')}</p>
            <h1 className="font-display mt-3 text-[2.65rem] leading-[1.02] text-forest">{t('auth.title')}</h1>
            <p className="mt-4 text-[0.94rem] font-medium leading-6 text-muted">{t('auth.subtitle')}</p>
            <img className="auth-landscape" src={montenegroHero} alt="" />
          </div>

          <div className="auth-form">
            <button type="button" className="btn-google w-full" disabled={loading} onClick={continueWithGoogle}><span className="google-g" aria-hidden="true">G</span>{loading ? t('authExperience.opening') : t('authExperience.google')}</button>
            <p className="mt-4 text-center text-sm font-medium leading-6 text-muted">{t('authExperience.accountHint')}</p>
            <p className="mt-3 text-center text-xs font-medium leading-5 text-muted">{t('authExperience.returningHint')}</p>
          </div>
        </section>
        <a className="support-login-link" href="/support"><Icon name="heart" size={16} />{t('support.action')}</a>
        <p className="mt-3 text-center text-xs font-bold tracking-wide text-muted">VratiMe · NVO LUNA</p>
      </main>
    </div>
  );
}
