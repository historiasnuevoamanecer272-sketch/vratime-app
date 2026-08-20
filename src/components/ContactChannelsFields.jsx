import { contactChannels, isTelegramPhone } from '../lib/contacts';
import Icon from './Icon';

export default function ContactChannelsFields({ contacts, onChange, t }) {
  const update = (channel, value) => onChange({ ...contacts, [channel]: value });
  const toggle = (channel, enabled) => update(channel, enabled ? (channel === 'tg' ? '@' : '') : '');
  const setTelegramMode = (mode) => update('tg', mode === 'phone' ? '+' : '@');

  return (
    <fieldset className="contact-channels">
      <legend className="field-label">{t('contacts.title')}</legend>
      <p className="contact-channels-note">{t('contacts.note')}</p>
      <div className="mt-3 space-y-3">
        {contactChannels.map((channel) => {
          const active = Boolean(contacts[channel.id]);
          const telegramPhone = channel.id === 'tg' && isTelegramPhone(contacts.tg);
          return <div className={`contact-channel ${active ? 'active' : ''}`} key={channel.id}>
            <label className="contact-channel-toggle"><input type="checkbox" checked={active} onChange={(event) => toggle(channel.id, event.target.checked)} /><span className="contact-channel-check"><Icon name="check" size={14} strokeWidth={2.8} /></span><strong>{channel.label}</strong></label>
            {active && channel.id === 'tg' ? <div className="telegram-mode" role="group" aria-label={t('contacts.telegramMethod')}><button type="button" className={telegramPhone ? '' : 'active'} onClick={() => setTelegramMode('alias')}>{t('contacts.telegramAlias')}</button><button type="button" className={telegramPhone ? 'active' : ''} onClick={() => setTelegramMode('phone')}>{t('contacts.telegramPhone')}</button></div> : null}
            {active ? <label className="contact-channel-input"><span className="sr-only">{channel.label}</span><input className="field" value={contacts[channel.id]} onChange={(event) => update(channel.id, event.target.value)} placeholder={channel.id === 'tg' ? t(telegramPhone ? 'contacts.telegramPhonePlaceholder' : 'contacts.telegramAliasPlaceholder') : channel.placeholder} inputMode={channel.id === 'tg' && telegramPhone ? 'tel' : channel.inputMode} autoCapitalize="none" autoComplete={channel.id === 'tg' ? 'off' : 'tel'} /></label> : null}
            {active && channel.id === 'tg' ? <p className="contact-channel-hint">{t(telegramPhone ? 'contacts.telegramPhoneHint' : 'contacts.telegramAliasHint')}</p> : null}
          </div>;
        })}
      </div>
    </fieldset>
  );
}
