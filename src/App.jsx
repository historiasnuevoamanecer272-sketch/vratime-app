import { useState, useEffect } from 'react';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import MapScreen from './pages/MapScreen';
import MyDeals from './pages/MyDeals';
import Profile from './pages/Profile';
import { supabase } from './supabaseClient';
import { subscribeToasts } from './lib/toast';

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
      else { setLoading(false); setIsProfileComplete(false); }
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

  if (loading) return <div className="flex items-center justify-center h-screen bg-white text-green-600 font-bold">VratiMe...</div>;
  if (!session) return <Login />;
  if (!isProfileComplete) return <Onboarding onComplete={() => setIsProfileComplete(true)} />;

  return (
    <div className="relative min-h-screen">
      {activeTab === 'map' && <MapScreen />}
      {activeTab === 'deals' && <MyDeals />}
      {activeTab === 'profile' && <Profile />}

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t pb-safe pt-2 px-4 flex justify-between items-center z-[5000] h-20 shadow-lg">
        <button
          onClick={() => setActiveTab('map')}
          className={`flex flex-col items-center w-16 ${activeTab === 'map' ? 'text-green-600' : 'text-gray-400'}`}
        >
          <span className="text-xl">📍</span>
          <span className="text-[10px] font-bold mt-1">Карта</span>
        </button>

        <button
          onClick={() => setActiveTab('deals')}
          className={`flex flex-col items-center w-16 ${activeTab === 'deals' ? 'text-green-600' : 'text-gray-400'}`}
        >
          <span className="text-xl">🤝</span>
          <span className="text-[10px] font-bold mt-1">Сделки</span>
        </button>

        <div className="w-16"></div>

        <button
          onClick={() => setActiveTab('profile')}
          className={`flex flex-col items-center w-16 ${activeTab === 'profile' ? 'text-green-600' : 'text-gray-400'}`}
        >
          <span className="text-xl">👤</span>
          <span className="text-[10px] font-bold mt-1">Профиль</span>
        </button>
      </nav>

      <div className="pointer-events-none fixed right-4 top-4 z-[6000] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-3 sm:right-6 sm:top-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-lg backdrop-blur ${
              toast.type === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : toast.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-gray-200 bg-white text-gray-700'
            }`}
          >
            <p className="text-sm font-medium">{toast.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
