import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { showToast } from '../lib/toast';

export default function Onboarding({ onComplete }) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    language: 'me',
    messenger_type: 'viber',
    phone: ''
  });

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          full_name: formData.full_name,
          language: formData.language,
          messenger_type: formData.messenger_type,
          phone: formData.phone,
          updated_at: new Date(),
        });

      if (error) throw error;

      onComplete();
    } catch (error) {
      showToast('Ошибка при сохранении: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 p-6">
      <h2 className="text-2xl font-bold mb-6 text-center mt-10">Настройка профиля</h2>

      <form onSubmit={handleSave} className="space-y-4 max-w-sm mx-auto w-full">
        <div>
          <label className="block text-sm text-gray-600 mb-1">Отображаемое имя</label>
          <input
            type="text"
            required
            value={formData.full_name}
            onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
            placeholder="Например: Марко"
            className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">Язык приложения</label>
          <select
            value={formData.language}
            onChange={(e) => setFormData({ ...formData, language: e.target.value })}
            className="w-full p-3 border rounded-lg bg-white outline-none"
          >
            <option value="me">Crnogorski</option>
            <option value="en">English</option>
            <option value="ru">Русский</option>
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">Мессенджер для связи</label>
          <select
            value={formData.messenger_type}
            onChange={(e) => setFormData({ ...formData, messenger_type: e.target.value })}
            className="w-full p-3 border rounded-lg bg-white outline-none"
          >
            <option value="viber">Viber</option>
            <option value="wa">WhatsApp</option>
            <option value="tg">Telegram</option>
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">Номер / Никнейм</label>
          <input
            type="text"
            required
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            placeholder="+382..."
            className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-green-600 text-white py-3 rounded-lg font-medium mt-6 hover:bg-green-700 transition disabled:opacity-50"
        >
          {loading ? 'Сохранение...' : 'Сохранить и продолжить'}
        </button>
      </form>
    </div>
  );
}
