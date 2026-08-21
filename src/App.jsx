import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from './supabaseClient';
import i18n, { getAppLanguage, setAppLanguage } from './i18n';
import { subscribeToasts } from './lib/toast';
import Icon from './components/Icon';

const Login = lazy(() => import('./pages/Login'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const MapScreen = lazy(() => import('./pages/MapScreen'));
const MyDeals = lazy(() => import('./pages/MyDeals'));
const Profile = lazy(() => import('./pages/Profile'));
const CreateListing = lazy(() => import('./pages/CreateListing'));

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);

export default function App() {
  const { t } = useTranslation();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileComplete, setProfileComplete] = useState(false);
  const [profileError, setProfileError] = useState(false);
  const [activeTab, setActiveTab] = useState('map');
  const [isCreating, setIsCreating] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(() => localStorage.getItem('vratimeInstallDismissed') === '1');
  const [isIosInstallCandidate] = useState(() => isIos() && !isStandalone());
  const profileUserRef = useRef(null);
  const profileRequestRef = useRef(0);

  const pushToast = useCallback((message, type = 'info') => {
    const toast = { id: `${Date.now()}-${Math.random()}`, message, type };
    setToasts((current) => [...current, toast]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== toast.id)), 3600);
  }, []);

  const checkProfile = useCallback(async (userId) => {
    const requestId = ++profileRequestRef.current;
    setProfileError(false);
    try {
      const [profileResult, contactResult] = await Promise.all([
        supabase.from('profiles').select('id, language, preferred_language').eq('id', userId).maybeSingle(),
        supabase.from('profile_contacts').select('messenger_type').eq('user_id', userId),
      ]);

      if (requestId !== profileRequestRef.current || profileUserRef.current !== userId) return;

      const { data, error } = profileResult;
      const contactError = contactResult.error;
      if (error || contactError) {
        console.error('Profile check failed:', error || contactError);
        setProfileComplete(false);
        setProfileError(true);
        pushToast(i18n.t('errors.load'), 'error');
      } else {
        setProfileError(false);
        setProfileComplete(Boolean(data?.id && contactResult.data?.length));
        const profileLanguage = data?.preferred_language || data?.language;
        if (profileLanguage && profileLanguage !== getAppLanguage()) setAppLanguage(profileLanguage);
      }
    } finally {
      if (requestId === profileRequestRef.current && profileUserRef.current === userId) setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    let active = true;
    let profileTimer;
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      const userId = nextSession?.user?.id || null;

      if (!userId) {
        profileUserRef.current = null;
        profileRequestRef.current += 1;
        setProfileComplete(false);
        setProfileError(false);
        setLoading(false);
        return;
      }

      // SIGNED_IN may fire again when a browser tab regains focus. The profile
      // is already known for this user, so do not replace the app with a splash.
      if (profileUserRef.current === userId) return;

      profileUserRef.current = userId;
      setLoading(true);
      // Supabase advises keeping auth callbacks synchronous. Defer database
      // queries until its internal auth lock has been released.
      profileTimer = window.setTimeout(() => {
        if (active && profileUserRef.current === userId) checkProfile(userId);
      }, 0);
    });
    return () => {
      active = false;
      window.clearTimeout(profileTimer);
      data.subscription.unsubscribe();
    };
  }, [checkProfile]);

  useEffect(() => subscribeToasts((toast) => pushToast(toast.message, toast.type)), [pushToast]);

  useEffect(() => {
    if (isStandalone() || installDismissed) return undefined;
    const ready = (event) => { event.preventDefault(); setInstallPrompt(event); setShowInstallHelp(true); };
    const installed = () => {
      setInstallPrompt(null); setShowInstallHelp(false); setInstallDismissed(true);
      localStorage.setItem('vratimeInstallDismissed', '1');
      pushToast(t('install.done'), 'success');
    };
    window.addEventListener('beforeinstallprompt', ready);
    window.addEventListener('appinstalled', installed);
    return () => { window.removeEventListener('beforeinstallprompt', ready); window.removeEventListener('appinstalled', installed); };
  }, [installDismissed, pushToast, t]);

  const dismissInstall = () => {
    setShowInstallHelp(false); setInstallDismissed(true);
    localStorage.setItem('vratimeInstallDismissed', '1');
  };

  const retryProfile = () => {
    const userId = session?.user?.id;
    if (!userId) return;
    profileUserRef.current = userId;
    setLoading(true);
    checkProfile(userId);
  };

  const loadingView = (
    <div className="app-screen grid min-h-screen place-items-center px-6">
      <div className="loading-card card w-full max-w-xs p-8 text-center">
        <div className="brand-orb mx-auto grid h-16 w-16 place-items-center"><Icon name="leaf" size={32} /></div>
        <p className="mt-4 font-display text-3xl text-forest">VratiMe</p>
        <p className="mt-2 text-sm font-semibold text-muted">{t('common.loading')}</p>
        <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-sage"><div className="loading-progress h-full w-2/3 rounded-full bg-forest" /></div>
      </div>
    </div>
  );

  const installBanner = !installDismissed && !isStandalone() && (showInstallHelp || isIosInstallCandidate) ? (
    <aside className="install-banner" aria-live="polite">
      <span className="icon-tile"><Icon name="install" size={22} /></span>
      <div className="min-w-0 flex-1">
        <p className="font-extrabold text-forest">{t('install.title')}</p>
        <p className="mt-1 text-xs leading-5 text-muted">{installPrompt ? t('install.android') : t('install.ios')}</p>
        {installPrompt ? <button type="button" className="btn-primary mt-2 min-h-9 px-4 text-sm" onClick={async () => { installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(null); setShowInstallHelp(false); }}>{t('install.action')}</button> : null}
      </div>
      <button type="button" className="icon-button" onClick={dismissInstall} aria-label={t('common.close')}><Icon name="close" size={17} /></button>
    </aside>
  ) : null;

  const toastStack = <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className={`toast toast-${toast.type}`}><p>{toast.message}</p></div>)}</div>;

  if (loading) return <>{installBanner}{loadingView}{toastStack}</>;
  if (!session) return <>{installBanner}<Suspense fallback={loadingView}><Login /></Suspense>{toastStack}</>;
  if (profileError) return <>{installBanner}<div className="app-screen grid min-h-screen place-items-center px-5"><div className="state-card"><Icon name="close" size={28} /><strong>{t('errors.load')}</strong><button type="button" className="btn-secondary" onClick={retryProfile}>{t('common.retry')}</button></div></div>{toastStack}</>;
  if (!profileComplete) return <>{installBanner}<Suspense fallback={loadingView}><Onboarding userId={session.user.id} onComplete={() => setProfileComplete(true)} /></Suspense>{toastStack}</>;

  const tabs = [
    { id: 'map', label: t('nav.map'), icon: 'map' },
    { id: 'deals', label: t('nav.deals'), icon: 'deals' },
    { id: 'create', label: t('nav.create'), icon: 'plus', action: true },
    { id: 'profile', label: t('nav.profile'), icon: 'user' },
  ];

  return (
    <div className="app-shell relative min-h-screen">
      <div inert={isCreating || undefined} aria-hidden={isCreating || undefined}>
        <Suspense fallback={loadingView}>
          {activeTab === 'map' ? <MapScreen userId={session.user.id} onCreate={() => setIsCreating(true)} /> : null}
          {activeTab === 'deals' ? <MyDeals /> : null}
          {activeTab === 'profile' ? <Profile userId={session.user.id} /> : null}
        </Suspense>

        <nav className="bottom-nav" aria-label={t('nav.label')}>
          <div className="bottom-nav-inner">
            {tabs.map((tab) => tab.action ? (
              <button key={tab.id} type="button" className="bottom-nav-button bottom-nav-create" onClick={() => setIsCreating(true)} aria-label={t('nav.create')}>
                <span className="bottom-nav-create-icon"><Icon name="plus" size={25} strokeWidth={2.6} /></span><span>{tab.label}</span>
              </button>
            ) : (
              <button key={tab.id} type="button" className={`bottom-nav-button ${activeTab === tab.id ? 'active' : ''}`} onClick={() => { setActiveTab(tab.id); setIsCreating(false); }} aria-current={activeTab === tab.id ? 'page' : undefined}>
                <Icon name={tab.icon} size={22} /><span>{tab.label}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>

      {isCreating ? <Suspense fallback={loadingView}><CreateListing userId={session.user.id} onBack={() => setIsCreating(false)} onSuccess={() => { setIsCreating(false); setActiveTab('map'); }} /></Suspense> : null}
      {toastStack}
    </div>
  );
}
