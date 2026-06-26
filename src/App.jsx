import { useState, useEffect } from 'react';
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

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isProfileComplete, setIsProfileComplete] = useState(false);
  const [activeTab, setActiveTab] = useState('map');
  const [toasts, setToasts] = useState([]);

  async function checkProfile(userId) {
    const { data } = await supabase.from('profiles').select('full_name, phone').eq('id', userId).single();
    if (data?.full_name && data?.phone) setIsProfileComplete(true);
    setLoading(false);
  }

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
  }, []);

  useEffect(() => {
    return subscribeToasts((toast) => {
      setToasts((current) => [...current, toast]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== toast.id));
      }, 3200);
    });
  }, []);

  if (loading) {
    return (
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
    );
  }

  if (!session) return <Login />;
  if (!isProfileComplete) return <Onboarding onComplete={() => setIsProfileComplete(true)} />;

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
