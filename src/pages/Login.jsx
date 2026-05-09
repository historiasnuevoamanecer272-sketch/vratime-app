import { useState } from 'react';
import { supabase } from '../supabaseClient';
import logo from '../assets/images/app-logo.png';
import { showToast } from '../lib/toast';

export default function Login() {
  const [email, setEmail] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) throw error;
      showToast('Проверь почту для входа!', 'success');
    } catch (error) {
      showToast(error.error_description || error.message, 'error');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
      <img src={logo} alt="VratiMe" className="w-32 h-32 mb-6" />
      <h1 className="text-3xl font-bold mb-2">VratiMe</h1>
      <p className="text-gray-600 mb-8 text-center">Обменивайся тарой. Спасай природу Черногории.</p>

      <form onSubmit={handleLogin} className="w-full max-w-sm flex flex-col gap-4">
        <input
          type="email"
          placeholder="Твой Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
          required
        />
        <button
          type="submit"
          className="w-full bg-green-600 text-white py-3 rounded-lg font-medium shadow-md hover:bg-green-700 transition"
        >
          Войти по Magic Link
        </button>
      </form>
    </div>
  );
}
