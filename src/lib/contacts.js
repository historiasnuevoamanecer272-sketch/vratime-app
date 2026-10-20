export const contactChannels = [
  { id: 'viber', label: 'Viber', placeholder: '+382 67 123 456', inputMode: 'tel' },
  { id: 'wa', label: 'WhatsApp', placeholder: '+382 67 123 456', inputMode: 'tel' },
  { id: 'tg', label: 'Telegram', placeholder: '@username', inputMode: 'text' },
];

export const emptyContactMap = () => ({ viber: '', wa: '', tg: '' });

export const contactsToMap = (contacts = []) => contacts.reduce((result, contact) => {
  if (contactChannels.some((channel) => channel.id === contact.messenger_type)) result[contact.messenger_type] = contact.contact_value || '';
  return result;
}, emptyContactMap());

export const isTelegramPhone = (value) => /^\+?[\d\s().-]+$/.test(String(value || '').trim());

const normalizePhone = (value) => {
  const raw = String(value || '').trim();
  if (!/^\+?[\d\s().-]+$/.test(raw)) return '';
  const digits = raw.replace(/\D/g, '').replace(/^00/, '');
  return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : '';
};

const normalizeTelegram = (value) => {
  const raw = String(value || '').trim().replace(/^https?:\/\/(?:www\.)?t\.me\//i, '');
  if (!raw) return '';
  if (isTelegramPhone(raw)) {
    const digits = raw.replace(/\D/g, '');
    return digits ? `+${digits.replace(/^00/, '')}` : '';
  }
  const alias = raw.replace(/^@+/, '');
  return alias ? `@${alias}` : '';
};

export const normalizeContacts = (contacts = {}) => contactChannels.flatMap((channel) => {
  const raw = String(contacts[channel.id] || '').trim();
  if (!raw) return [];
  return [{ messenger_type: channel.id, contact_value: channel.id === 'tg' ? normalizeTelegram(raw) : normalizePhone(raw) }];
});

export const validateContacts = (contacts = {}) => {
  const values = normalizeContacts(contacts);
  if (!values.length) return 'contactRequired';
  if (values.some((contact) => contact.contact_value.length < 3 || contact.contact_value.length > 120)) return 'contactInvalid';
  if (values.some((contact) => contact.messenger_type === 'tg' && !/^@[A-Za-z0-9_]{5,32}$/.test(contact.contact_value) && !/^\+[1-9]\d{6,14}$/.test(contact.contact_value))) return 'telegramInvalid';
  return '';
};

export const contactHref = (contact) => {
  const value = contact?.contact_value || '';
  const phone = normalizePhone(value);
  if (contact?.messenger_type === 'wa') return phone ? `https://wa.me/${phone.slice(1)}` : undefined;
  if (contact?.messenger_type === 'tg') return value.startsWith('@')
    ? `https://t.me/${value.slice(1)}`
    : `tg://resolve?phone=${value.replace(/\D/g, '')}`;
  if (contact?.messenger_type === 'viber') return phone ? `viber://chat?number=${phone}` : undefined;
  return undefined;
};
