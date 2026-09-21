import { useTranslation } from 'react-i18next';
import SupportFund from '../components/SupportFund';
import Icon from '../components/Icon';
import montenegroHero from '../assets/visuals/v2/montenegro-adriatic-hero-v1.webp';

export default function SupportPage() {
  const { t } = useTranslation();
  return (
    <main className="support-page app-screen">
      <div className="support-page-shell">
        <a className="support-back" href="/"><Icon name="arrowLeft" size={18} />{t('common.back')}</a>
        <div className="support-region" aria-hidden="true"><img src={montenegroHero} alt="" /><span><Icon name="mountain" size={20} /><Icon name="waves" size={20} /></span></div>
        <SupportFund page />
      </div>
    </main>
  );
}
