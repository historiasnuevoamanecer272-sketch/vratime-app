import { Trans, useTranslation } from 'react-i18next';
import logo from '../assets/images/app-logo.png';
import LanguageMenu from '../components/LanguageMenu';
import { getAppLanguage, setAppLanguage } from '../i18n';
import Icon from '../components/Icon';

const supportEmail = 'historiasnuevoamanecer272@gmail.com';
const sectionOrder = {
  privacy: ['controller', 'data', 'purpose', 'storage', 'contacts', 'retention', 'support', 'changes'],
  offer: ['platform', 'account', 'listings', 'prohibited', 'responsibility', 'termination', 'acceptance', 'support'],
};

function LegalDocument({ document }) {
  const { t } = useTranslation();
  const language = getAppLanguage();
  const updatedAt = new Intl.DateTimeFormat(language === 'me' ? 'sr-Latn-ME' : language, {
    dateStyle: 'long', timeZone: 'UTC',
  }).format(new Date('2026-10-18T00:00:00Z'));

  return (
    <main className="legal-page">
      <article className="legal-card">
        <a className="legal-back" href={import.meta.env.BASE_URL || '/'}><Icon name="arrowLeft" size={28} /><span>{t('authExperience.back')}</span></a>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <a className="legal-brand" href="/" aria-label="VratiMe">
            <img src={logo} alt="" />
            <span>VratiMe</span>
          </a>
          <LanguageMenu value={language} onChange={setAppLanguage} label={t('profile.language')} />
        </div>
        <p className="eyebrow text-sea">{t('legal.eyebrow')}</p>
        <h1 className="font-display text-4xl text-forest">{t(`legal.${document}.title`)}</h1>
        <p className="legal-intro">{t(`legal.${document}.intro`)}</p>
        <p className="legal-updated">{t('legal.updatedAt', { date: updatedAt })}</p>
        {sectionOrder[document].map((section) => {
          const key = `legal.${document}.sections.${section}`;
          const paragraphs = t(`${key}.paragraphs`, { returnObjects: true });
          return <section className="legal-section" key={section}>
            <h2>{t(`${key}.title`)}</h2>
            {paragraphs.map((_, index) => <p key={index}>
              <Trans t={t} i18nKey={`${key}.paragraphs.${index}`} values={{ supportEmail }} components={{ contact: <a href={`mailto:${supportEmail}`} /> }} />
            </p>)}
          </section>;
        })}
        <footer className="legal-footer">
          <a href="/support">{t('support.action')}</a>
          <a href="/privacy">{t('legal.privacy.title')}</a>
          <a href="/offer">{t('legal.offer.link')}</a>
          <a href="/">{t('legal.back')}</a>
        </footer>
      </article>
    </main>
  );
}

export function PrivacyPage() {
  return <LegalDocument document="privacy" />;
}

export function OfferPage() {
  return <LegalDocument document="offer" />;
}
