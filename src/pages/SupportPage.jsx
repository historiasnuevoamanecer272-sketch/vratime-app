import { useTranslation } from 'react-i18next';
import SupportFund from '../components/SupportFund';
import Icon from '../components/Icon';

export default function SupportPage() {
  const { t } = useTranslation();
  return (
    <main className="support-page app-screen">
      <div className="support-page-shell">
        <a className="support-back" href="/"><Icon name="arrowLeft" size={18} />{t('common.back')}</a>
        <SupportFund page />
      </div>
    </main>
  );
}
