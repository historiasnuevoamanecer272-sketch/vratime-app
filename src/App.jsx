import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from './supabaseClient';
import { setAppLanguage } from './i18n';
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
  const [activeTab, setActiveTab] = useState('map');
  const [isCreating, setIsCreating] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(() => localStorage.getItem('vratimeInstallDismissed') === '1');
  const [isIosInstallCandidate] = useState(() => isIos() && !isStandalone());

  const pushToast = useCallback((message, type = 'info') => {
    const toast = { id: `${Date.now()}-${Math.random()}`, message, type };
    setToasts((current) => [...current, toast]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== toast.id)), 3600);
  }, []);

  const checkProfile = useCallback(async (userId) => {
    setLoading(true);
    const { data, error } = await supabase.from('profiles').select('id, language, preferred_language').eq('id', userId).maybeSingle();
    if (error) {
      console.error('Profile check failed:', error);
      setProfileComplete(true);
      pushToast(t('errors.load'), 'error');
    } else {
      setProfileComplete(Boolean(data?.id));
      if (data?.preferred_language || data?.language) setAppLanguage(data.preferred_language || data.language);
    }
    setLoading(false);
  }, [pushToast, t]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) checkProfile(data.session.user.id);
      else setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) checkProfile(nextSession.user.id);
      else { setLoading(false); setProfileComplete(false); }
    });
    return () => data.subscription.unsubscribe();
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

  if (loading) return <>{installBanner}{loadingView}</>;
  if (!session) return <>{installBanner}<Suspense fallback={loadingView}><Login /></Suspense></>;
  if (!profileComplete) return <>{installBanner}<Suspense fallback={loadingView}><Onboarding onComplete={() => setProfileComplete(true)} /></Suspense></>;

  const tabs = [
    { id: 'map', label: t('nav.map'), icon: 'map' },
    { id: 'deals', label: t('nav.deals'), icon: 'deals' },
    { id: 'create', label: t('nav.create'), icon: 'plus', action: true },
    { id: 'profile', label: t('nav.profile'), icon: 'user' },
  ];

  return (
    <div className="app-shell relative min-h-screen">
      <Suspense fallback={loadingView}>
        {activeTab === 'map' ? <MapScreen onCreate={() => setIsCreating(true)} /> : null}
        {activeTab === 'deals' ? <MyDeals /> : null}
        {activeTab === 'profile' ? <Profile /> : null}
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

      {isCreating ? <Suspense fallback={loadingView}><CreateListing onBack={() => setIsCreating(false)} onSuccess={() => { setIsCreating(false); setActiveTab('map'); }} /></Suspense> : null}
      <div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className={`toast toast-${toast.type}`}><p>{toast.message}</p></div>)}</div>
    </div>
  );
}
