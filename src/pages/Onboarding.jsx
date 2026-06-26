import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { showToast } from '../lib/toast';
import Icon from '../components/Icon';

export default function Onboarding({ onComplete }) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    language: 'me',
    messenger_type: 'viber',
    phone: '',
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
    <div className="app-screen min-h-screen px-5 py-8">
      <main className="app-container">
        <section className="card p-5">
          <div className="mb-6 rounded-[28px] bg-emerald-50 p-5">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-emerald-700 shadow-sm">
              <Icon name="user" size={28} />
            </div>
            <p className="section-title">Первый запуск</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-gray-950">Настройка профиля</h1>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Эти данные помогут участникам быстро договориться о передаче тары.
            </p>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <label className="block space-y-2">
              <span className="text-sm font-bold text-gray-700">Отображаемое имя</span>
              <input
                type="text"
                required
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                placeholder="Например: Марко"
                className="field"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-bold text-gray-700">Язык приложения</span>
              <select
                value={formData.language}
                onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                className="field"
              >
                <option value="me">Crnogorski</option>
                <option value="en">English</option>
                <option value="ru">Русский</option>
              </select>
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-bold text-gray-700">Мессенджер для связи</span>
              <select
                value={formData.messenger_type}
                onChange={(e) => setFormData({ ...formData, messenger_type: e.target.value })}
                className="field"
              >
                <option value="viber">Viber</option>
                <option value="wa">WhatsApp</option>
                <option value="tg">Telegram</option>
              </select>
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-bold text-gray-700">Номер или никнейм</span>
              <input
                type="text"
                required
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+382..."
                className="field"
              />
            </label>

            <button type="submit" disabled={loading} className="btn-primary mt-2 w-full">
              <Icon name="check" size={20} />
              {loading ? 'Сохраняем...' : 'Сохранить и продолжить'}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
