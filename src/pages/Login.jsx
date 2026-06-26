import { useState } from 'react';
import { supabase } from '../supabaseClient';
import logo from '../assets/images/app-logo.png';
import { showToast } from '../lib/toast';
import Icon from '../components/Icon';

export default function Login() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [recentEmails, setRecentEmails] = useState(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('vratimeRecentEmails') || '[]');
      return Array.isArray(saved) ? saved.slice(0, 4) : [];
    } catch {
      return [];
    }
  });
  const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`;

  const rememberEmail = (value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return;

    const next = [normalized, ...recentEmails.filter((item) => item !== normalized)].slice(0, 4);
    setRecentEmails(next);
    window.localStorage.setItem('vratimeRecentEmails', JSON.stringify(next));
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (isLoading) return;

    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      showToast('Введите корректный email', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: redirectTo,
        },
      });
      if (error) throw error;
      rememberEmail(normalizedEmail);
      showToast('Проверь почту для входа!', 'success');
    } catch (error) {
      const message =
        error?.status === 429
          ? 'Слишком много попыток. Подождите минуту и попробуйте снова.'
          : error.error_description || error.message;
      showToast(message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOAuthLogin = async (provider) => {
    if (isLoading) return;

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
        },
      });
      if (error) throw error;
    } catch (error) {
      showToast(error.error_description || error.message, 'error');
      setIsLoading(false);
    }
  };

  return (
    <div className="app-screen flex min-h-screen items-center justify-center py-8">
      <main className="auth-container">
        <section className="card overflow-hidden p-5">
          <div className="rounded-[28px] bg-gradient-to-br from-emerald-100 via-white to-sky-50 p-6 text-center">
            <div className="mx-auto mb-5 flex h-28 w-28 items-center justify-center rounded-[32px] bg-white shadow-[0_18px_42px_rgba(22,138,74,0.16)]">
              <img src={logo} alt="VratiMe" className="h-20 w-20 object-contain" />
            </div>
            <div className="mx-auto mb-3 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] text-emerald-700">
              <Icon name="leaf" size={15} />
              Eco exchange
            </div>
            <h1 className="text-4xl font-black tracking-tight text-gray-950">VratiMe</h1>
            <p className="mx-auto mt-3 max-w-xs text-balance text-base font-medium leading-6 text-gray-600">
              Обменивайся тарой. Спасай природу Черногории.
            </p>
          </div>

          <form onSubmit={handleLogin} className="mt-6 flex flex-col gap-4">
            <label className="space-y-2">
              <span className="text-sm font-bold text-gray-700">Email для входа</span>
              <input
                id="login-email"
                type="text"
                name="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="send"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="field"
                required
              />
            </label>

            {recentEmails.length > 0 ? (
              <div className="scroll-row -mt-1 flex gap-2 overflow-x-auto pb-1">
                {recentEmails.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setEmail(item)}
                    className="chip max-w-[220px] overflow-hidden text-ellipsis text-xs"
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : null}

            <button type="submit" disabled={isLoading} className="btn-primary w-full">
              <Icon name="mail" size={20} />
              {isLoading ? 'Отправляем ссылку...' : 'Войти по Magic Link'}
            </button>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isLoading}
                onClick={() => handleOAuthLogin('google')}
                className="btn-ghost w-full text-sm"
              >
                Google
              </button>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => handleOAuthLogin('facebook')}
                className="btn-ghost w-full text-sm"
              >
                Facebook
              </button>
            </div>

            <p className="px-2 text-center text-xs font-medium leading-5 text-gray-500">
              Если письмо не пришло, проверь папку «Спам» или войди через соцсеть.
            </p>
          </form>
        </section>
      </main>
    </div>
  );
}
