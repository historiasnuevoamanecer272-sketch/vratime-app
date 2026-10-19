import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from './supabaseClient';
import i18n, { getAppLanguage, setAppLanguage } from './i18n';
import { resolveProfileLanguage } from './i18n/languages';
import { subscribeToasts } from './lib/toast';
import Icon from './components/Icon';
import logo from './assets/images/app-logo.png';
import { OfferPage, PrivacyPage } from './pages/LegalPage';
import SupportPage from './pages/SupportPage';
import OfflineNotice from './components/OfflineNotice';
import UpdateNotice from './components/UpdateNotice';
import CreationLayer from './components/CreationLayer';
import { AppNavigationContext } from './lib/appNavigationContext';
import { useAppNavigationState } from './hooks/useAppNavigation';
import { cleanAuthReturnUrl, readAuthReturn, startSessionBootstrap } from './lib/sessionBootstrap';
import { canOfferInstall, installDeviceStorage, installMilestoneEvent, markInstallMilestone, recordInstallDismissal } from './lib/installExperience';
import { observeVisualViewport } from './lib/visualViewport';
import { retirePushForAccountChange } from './lib/pushPreferences';
import { disablePushSubscriptionForSession } from './lib/api';
import './styles/navigation-ux.css';

const Login = lazy(() => import('./pages/Login'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const MapScreen = lazy(() => import('./pages/MapScreen'));
const MyDeals = lazy(() => import('./pages/MyDeals'));
const Profile = lazy(() => import('./pages/Profile'));
const CreateListing = lazy(() => import('./pages/CreateListing'));

const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);

class AppScreenBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('VratiMe screen failed to render:', error);
  }

  render() {
    if (this.state.failed) {
      return <div className="app-screen grid min-h-screen place-items-center px-5"><div className="state-card text-center"><Icon name="close" size={28} /><strong>{this.props.message}</strong><button type="button" className="btn-secondary mt-4" onClick={() => window.location.reload()}>{this.props.retryLabel}</button></div></div>;
    }
    return this.props.children;
  }
}

export default function App() {
  const { t } = useTranslation();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileComplete, setProfileComplete] = useState(false);
  const [profileError, setProfileError] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingListing, setEditingListing] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallHelp, setShowInstallHelp] = useState(() => canOfferInstall(installDeviceStorage()));
  const [authReturn] = useState(() => readAuthReturn(window.location.href));
  const [authNotice, setAuthNotice] = useState(() => authReturn.failed ? 'error' : authReturn.pending ? 'pending' : null);
  const [authError, setAuthError] = useState(false);
  const [authAttempt, setAuthAttempt] = useState(0);
  const profileUserRef = useRef(null);
  const profileRequestRef = useRef(0);
  const creationBusyRef = useRef(false);
  const pushSessionRef = useRef(null);
  const onCreationBusy = useCallback((busy) => {
    if (profileUserRef.current === session?.user?.id) creationBusyRef.current = busy;
  }, [session?.user?.id]);
  const navigation = useAppNavigationState(Boolean(session && profileComplete && !loading && !profileError && !['/privacy', '/offer', '/support'].includes(window.location.pathname)));
  const { activeTab, visitedTabs, navigate } = navigation;

  const pushToast = useCallback((message, type = 'info', options = {}) => {
    const toast = { id: `${Date.now()}-${Math.random()}`, message, type, prominent: Boolean(options.prominent) };
    setToasts((current) => [...current, toast]);
  }, []);

  const dismissToast = useCallback((toastId) => {
    setToasts((current) => current.filter((item) => item.id !== toastId));
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
        const complete = Boolean(data?.id && contactResult.data?.length);
        setProfileComplete(complete);
        const profileLanguage = resolveProfileLanguage(data, getAppLanguage(), complete);
        if (profileLanguage && profileLanguage !== getAppLanguage()) setAppLanguage(profileLanguage);
      }
    } catch {
      if (requestId === profileRequestRef.current && profileUserRef.current === userId) {
        setProfileComplete(false);
        setProfileError(true);
        pushToast(i18n.t('errors.load'), 'error');
      }
    } finally {
      if (requestId === profileRequestRef.current && profileUserRef.current === userId) setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    let active = true;
    let profileTimer;
    const cleanCallback = () => {
      const cleanUrl = cleanAuthReturnUrl(window.location.href);
      if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== cleanUrl) window.history.replaceState(window.history.state, '', cleanUrl);
    };
    const stop = startSessionBootstrap(supabase.auth, { onSession: (nextSession) => {
      if (!active) return;
      const previousSession = pushSessionRef.current;
      pushSessionRef.current = nextSession;
      retirePushForAccountChange({ previousSession, nextSession, api: { disablePushSubscriptionForSession } }).catch(() => {});
      cleanCallback();
      setAuthError(false);
      setAuthNotice(nextSession ? null : authReturn.pending || authReturn.failed ? 'error' : null);
      const userId = nextSession?.user?.id || null;
      if (profileUserRef.current !== userId) {
        creationBusyRef.current = false;
        setIsCreating(false);
        setEditingListing(null);
        setToasts([]);
      }
      setSession(nextSession);

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
    }, onError: () => {
      if (!active) return;
      cleanCallback();
      setAuthError(true);
      setAuthNotice('error');
      setLoading(false);
    } });
    return () => {
      active = false;
      window.clearTimeout(profileTimer);
      stop();
    };
  }, [checkProfile, authAttempt, authReturn]);

  useEffect(() => observeVisualViewport(), []);

  useEffect(() => subscribeToasts((toast) => pushToast(toast.message, toast.type, toast)), [pushToast]);

  useEffect(() => {
    if (isStandalone()) return undefined;
    const ready = (event) => { event.preventDefault(); setInstallPrompt(event); };
    const milestone = () => setShowInstallHelp(canOfferInstall(installDeviceStorage()));
    const installed = () => {
      setInstallPrompt(null); setShowInstallHelp(false);
      recordInstallDismissal(installDeviceStorage());
      pushToast(t('install.done'), 'success');
    };
    window.addEventListener('beforeinstallprompt', ready);
    window.addEventListener('appinstalled', installed);
    window.addEventListener(installMilestoneEvent, milestone);
    return () => { window.removeEventListener('beforeinstallprompt', ready); window.removeEventListener('appinstalled', installed); window.removeEventListener(installMilestoneEvent, milestone); };
  }, [pushToast, t]);

  const dismissInstall = () => {
    recordInstallDismissal(installDeviceStorage());
    setShowInstallHelp(false);
  };

  const retryAuth = () => {
    setAuthError(false);
    setAuthNotice('pending');
    setLoading(true);
    setAuthAttempt((value) => value + 1);
  };

  const closeCreation = useCallback(() => {
    if (creationBusyRef.current) return false;
    setIsCreating(false); setEditingListing(null);
    return true;
  }, []);

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
        <div className="brand-orb mx-auto grid h-16 w-16 place-items-center"><img className="loading-logo" src={logo} alt="" /></div>
        <p className="mt-4 font-display text-3xl text-forest">VratiMe</p>
        <p className="mt-2 text-sm font-semibold text-muted" role="status">{t(authNotice === 'pending' ? 'navigationExperience.completingSignIn' : 'common.loading')}</p>
        <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-sage"><div className="loading-progress h-full w-2/3 rounded-full bg-forest" /></div>
      </div>
    </div>
  );

  const installBanner = !isStandalone() && showInstallHelp && !isCreating && navigation.overlayCount === 0 ? (
    <aside className="install-banner" aria-live="polite">
      <span className="icon-tile"><Icon name="install" size={22} /></span>
      <div className="min-w-0 flex-1">
        <p className="font-extrabold text-forest">{t('install.title')}</p>
        <p className="mt-1 text-xs leading-5 text-muted">{installPrompt ? t('navigationExperience.installAndroid') : isIos() ? t('install.ios') : t('install.manual')}</p>
        <p className="mt-1 text-xs leading-5 text-muted">{t('navigationExperience.installedSession')}</p>
        {installPrompt ? <button type="button" className="btn-primary mt-2 min-h-9 px-4 text-sm" onClick={async () => {
          try { await installPrompt.prompt(); await installPrompt.userChoice; }
          catch { pushToast(t('install.manual'), 'info'); }
          finally { setInstallPrompt(null); dismissInstall(); }
        }}>{t('install.action')}</button> : null}
      </div>
      <button type="button" className="icon-button" onClick={dismissInstall} aria-label={t('common.close')}><Icon name="close" size={17} /></button>
    </aside>
  ) : null;

  const toastStack = <><OfflineNotice /><UpdateNotice /><div className="toast-stack" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className={`toast toast-${toast.type} ${toast.prominent ? 'toast-prominent' : ''}`} role="status"><span className="toast-symbol"><Icon name={toast.type === 'success' ? 'check' : toast.type === 'error' ? 'close' : 'message'} size={toast.prominent ? 30 : 18} /></span><p>{toast.message}</p><button type="button" onClick={() => dismissToast(toast.id)}>{t('common.ok')}</button></div>)}</div></>;

  if (window.location.pathname === '/privacy') return <><PrivacyPage />{toastStack}</>;
  if (window.location.pathname === '/offer') return <><OfferPage />{toastStack}</>;
  if (window.location.pathname === '/support') return <><SupportPage />{toastStack}</>;

  if (authError) return <><div className="app-screen grid min-h-screen place-items-center px-5"><div className="state-card" role="alert"><Icon name="close" size={28} /><strong>{t('navigationExperience.sessionUnavailable')}</strong><button type="button" className="btn-secondary" onClick={retryAuth}>{t('common.retry')}</button></div></div>{toastStack}</>;
  if (loading) return <>{loadingView}{toastStack}</>;
  if (!session) return <>{authNotice === 'error' ? <aside className="auth-return-notice" role="alert"><p>{t('navigationExperience.signInFailed')}</p><button type="button" className="btn-secondary" onClick={retryAuth}>{t('common.retry')}</button></aside> : null}<Suspense fallback={loadingView}><Login /></Suspense>{toastStack}</>;
  if (profileError) return <><div className="app-screen grid min-h-screen place-items-center px-5"><div className="state-card"><Icon name="close" size={28} /><strong>{t('errors.load')}</strong><button type="button" className="btn-secondary" onClick={retryProfile}>{t('common.retry')}</button></div></div>{toastStack}</>;
  if (!profileComplete) return <><Suspense fallback={loadingView}><Onboarding userId={session.user.id} onComplete={() => setProfileComplete(true)} /></Suspense>{toastStack}</>;

  const tabs = [
    { id: 'map', label: t('nav.map'), icon: 'map' },
    { id: 'deals', label: t('nav.deals'), icon: 'handshake' },
    { id: 'create', label: t('nav.create'), icon: 'plus', action: true },
    { id: 'profile', label: t('nav.profile'), icon: 'user' },
  ];

  return (
    <AppNavigationContext.Provider value={navigation.context}>
    <div className="app-shell relative min-h-screen">
      {installBanner}
      <AppScreenBoundary message={t('errors.load')} retryLabel={t('common.retry')}>
        <div key={session.user.id} inert={isCreating || undefined}>
          {visitedTabs.includes('map') ? <section className="app-tab" hidden={activeTab !== 'map'}><Suspense fallback={loadingView}><MapScreen active={activeTab === 'map' && !isCreating} userId={session.user.id} onCreate={() => { setEditingListing(null); setIsCreating(true); }} /></Suspense></section> : null}
          {visitedTabs.includes('deals') ? <section className="app-tab" hidden={activeTab !== 'deals'}><Suspense fallback={loadingView}><MyDeals active={activeTab === 'deals' && !isCreating} /></Suspense></section> : null}
          {visitedTabs.includes('profile') ? <section className="app-tab" hidden={activeTab !== 'profile'}><Suspense fallback={loadingView}><Profile active={activeTab === 'profile' && !isCreating} userId={session.user.id} onEditListing={(listing) => { setEditingListing(listing); setIsCreating(true); }} /></Suspense></section> : null}

          <nav className="bottom-nav" aria-label={t('nav.label')}>
            <div className="bottom-nav-inner">
              {tabs.map((tab) => tab.action ? (
                <button key={tab.id} type="button" className="bottom-nav-button bottom-nav-create" onClick={() => { setEditingListing(null); setIsCreating(true); }} aria-label={t('nav.create')}>
                  <span className="bottom-nav-create-icon"><Icon name="plus" size={25} strokeWidth={2.6} /></span><span>{tab.label}</span>
                </button>
              ) : (
                <button key={tab.id} type="button" className={`bottom-nav-button nav-${tab.id} ${activeTab === tab.id ? 'active' : ''}`} onClick={() => navigate(tab.id)} aria-current={activeTab === tab.id ? 'page' : undefined}>
                  <Icon name={tab.icon} size={22} /><span>{tab.label}</span>
                </button>
              ))}
            </div>
          </nav>
        </div>

        {isCreating ? <Suspense fallback={loadingView}><CreationLayer key={session.user.id} onClose={closeCreation}><CreateListing userId={session.user.id} editingListing={editingListing} onBusyChange={onCreationBusy} onBack={closeCreation} onSuccess={() => { creationBusyRef.current = false; markInstallMilestone('listing'); const destination = editingListing ? 'profile' : 'map'; closeCreation(); navigate(destination); }} /></CreationLayer></Suspense> : null}
      </AppScreenBoundary>
      {toastStack}
    </div>
    </AppNavigationContext.Provider>
  );
}
