import { useState, useEffect, useCallback } from 'react';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import MapScreen from './pages/MapScreen';
import MyDeals from './pages/MyDeals';
import Profile from './pages/Profile';
import { supabase } from './supabaseClient';
import { subscribeToasts } from './lib/toast';
import Icon from './components/Icon';

const tabs = [
  { id: 'map', label: 'Карта', icon: 'map' },
  { id: 'deals', label: 'Сделки', icon: 'deals' },
  { id: 'profile', label: 'Профиль', icon: 'user' },
];

const isStandaloneApp = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

const isIosDevice = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isProfileComplete, setIsProfileComplete] = useState(false);
  const [activeTab, setActiveTab] = useState('map');
  const [toasts, setToasts] = useState([]);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(
    () => window.localStorage.getItem('vratimeInstallDismissed') === '1'
  );
  const [isIosInstallCandidate] = useState(() => isIosDevice() && !isStandaloneApp());

  const pushToast = useCallback((message, type = 'info') => {
    const toast = { id: Date.now(), message, type };
    setToasts((current) => [...current, toast]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== toast.id));
    }, 3200);
  }, []);

  const checkProfile = useCallback(async (userId) => {
    setLoading(true);
    const { data, error } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();

    if (error) {
      console.error('Profile check failed:', error);
      setIsProfileComplete(true);
      pushToast('Профиль временно не загрузился. Открыли приложение, данные можно проверить позже.', 'error');
    } else {
      setIsProfileComplete(Boolean(data?.id));
    }

    setLoading(false);
  }, [pushToast]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) checkProfile(session.user.id);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) checkProfile(session.user.id);
      else {
        setLoading(false);
        setIsProfileComplete(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [checkProfile]);

  useEffect(() => {
    return subscribeToasts((toast) => {
      setToasts((current) => [...current, toast]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, 3200);
    });
  }, []);

  useEffect(() => {
    if (isStandaloneApp() || installDismissed) return undefined;

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
      setShowInstallHelp(true);
    };

    const handleInstalled = () => {
      setInstallPrompt(null);
      setShowInstallHelp(false);
      setInstallDismissed(true);
      window.localStorage.setItem('vratimeInstallDismissed', '1');
      pushToast('Приложение установлено', 'success');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, [installDismissed, pushToast]);

  const handleInstall = async () => {
    if (!installPrompt) return;

    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
    setShowInstallHelp(false);
  };

  const dismissInstallPrompt = () => {
    setShowInstallHelp(false);
    setInstallDismissed(true);
    window.localStorage.setItem('vratimeInstallDismissed', '1');
  };

  const installBanner = !installDismissed && !isStandaloneApp() && (showInstallHelp || isIosInstallCandidate) ? (
    <div className="fixed inset-x-3 top-3 z-[6500] mx-auto max-w-md rounded-[22px] border border-emerald-200 bg-white/95 p-3 shadow-[0_18px_44px_rgba(15,23,42,0.16)] backdrop-blur">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
          <Icon name="install" size={23} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black text-gray-950">Установить VratiMe</p>
          <p className="mt-1 text-xs font-medium leading-5 text-gray-600">
            {installPrompt
              ? 'Откроется как обычное приложение и будет дольше сохранять вход.'
              : 'На iPhone: нажмите «Поделиться» и выберите «На экран Домой».'}
          </p>
          {installPrompt ? (
            <button type="button" onClick={handleInstall} className="btn-primary mt-3 h-10 min-h-10 px-4 text-sm">
              Установить
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={dismissInstallPrompt}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500"
          aria-label="Скрыть"
        >
          <Icon name="close" size={17} />
        </button>
      </div>
    </div>
  ) : null;

  if (loading) {
    return (
      <>
        {installBanner}
        <div className="app-screen flex min-h-screen items-center justify-center px-6">
          <div className="card flex w-full max-w-xs flex-col items-center p-8 text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-[22px] bg-emerald-100 text-emerald-700">
              <Icon name="leaf" size={34} />
            </div>
            <p className="text-2xl font-black text-gray-950">VratiMe</p>
            <p className="mt-2 text-sm font-medium text-gray-500">Загружаем приложение</p>
            <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-emerald-100">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-emerald-500" />
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!session) {
    return (
      <>
        {installBanner}
        <Login />
      </>
    );
  }
  if (!isProfileComplete) {
    return (
      <>
        {installBanner}
        <Onboarding onComplete={() => setIsProfileComplete(true)} />
      </>
    );
  }

  return (
    <div className="app-shell relative min-h-screen">
      {activeTab === 'map' && <MapScreen />}
      {activeTab === 'deals' && <MyDeals />}
      {activeTab === 'profile' && <Profile />}

      <nav className="bottom-nav fixed bottom-0 left-0 right-0 z-[5000] px-4 pt-2">
        <div className="mx-auto flex max-w-md items-center justify-between">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`bottom-nav-button ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon name={tab.icon} size={22} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="pointer-events-none fixed right-4 top-4 z-[6000] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-3 sm:right-6 sm:top-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-[20px] border px-4 py-3 shadow-[0_18px_44px_rgba(15,23,42,0.14)] backdrop-blur ${
              toast.type === 'error'
                ? 'border-red-200 bg-red-50/95 text-red-700'
                : toast.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50/95 text-emerald-800'
                  : 'border-gray-200 bg-white/95 text-gray-700'
            }`}
          >
            <p className="text-sm font-semibold">{toast.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
