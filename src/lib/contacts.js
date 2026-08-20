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

const normalizeTelegram = (value) => {
  const alias = String(value || '').trim().replace(/^https?:\/\/(?:www\.)?t\.me\//i, '').replace(/^@+/, '');
  return alias ? `@${alias}` : '';
};

export const normalizeContacts = (contacts = {}) => contactChannels.flatMap((channel) => {
  const raw = String(contacts[channel.id] || '').trim();
  if (!raw) return [];
  return [{ messenger_type: channel.id, contact_value: channel.id === 'tg' ? normalizeTelegram(raw) : raw }];
});

export const validateContacts = (contacts = {}) => {
  const values = normalizeContacts(contacts);
  if (!values.length) return 'contactRequired';
  if (values.some((contact) => contact.contact_value.length < 3 || contact.contact_value.length > 120)) return 'contactInvalid';
  if (values.some((contact) => contact.messenger_type === 'tg' && !/^@[A-Za-z0-9_]{5,32}$/.test(contact.contact_value))) return 'telegramInvalid';
  return '';
};

export const contactHref = (contact) => {
  const value = contact?.contact_value || '';
  if (contact?.messenger_type === 'wa') return `https://wa.me/${value.replace(/\D/g, '')}`;
  if (contact?.messenger_type === 'tg') return `https://t.me/${value.replace(/^@/, '')}`;
  if (contact?.messenger_type === 'viber') return `viber://chat?number=${value.replace(/[^+\d]/g, '')}`;
  return undefined;
};
