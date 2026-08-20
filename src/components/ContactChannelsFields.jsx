import { contactChannels } from '../lib/contacts';
import Icon from './Icon';

export default function ContactChannelsFields({ contacts, onChange, t }) {
  const update = (channel, value) => onChange({ ...contacts, [channel]: value });
  const toggle = (channel, enabled) => update(channel, enabled ? (channel === 'tg' ? '@' : '') : '');

  return (
    <fieldset className="contact-channels">
      <legend className="field-label">{t('contacts.title')}</legend>
      <p className="contact-channels-note">{t('contacts.note')}</p>
      <div className="mt-3 space-y-3">
        {contactChannels.map((channel) => {
          const active = Boolean(contacts[channel.id]);
          return <div className={`contact-channel ${active ? 'active' : ''}`} key={channel.id}>
            <label className="contact-channel-toggle"><input type="checkbox" checked={active} onChange={(event) => toggle(channel.id, event.target.checked)} /><span className="contact-channel-check"><Icon name="check" size={14} strokeWidth={2.8} /></span><strong>{channel.label}</strong></label>
            {active ? <label className="contact-channel-input"><span className="sr-only">{channel.label}</span><input className="field" value={contacts[channel.id]} onChange={(event) => update(channel.id, event.target.value)} placeholder={channel.placeholder} inputMode={channel.inputMode} autoCapitalize="none" autoComplete={channel.id === 'tg' ? 'off' : 'tel'} /></label> : null}
            {active && channel.id === 'tg' ? <p className="contact-channel-hint">{t('contacts.telegramHint')}</p> : null}
          </div>;
        })}
      </div>
    </fieldset>
  );
}
