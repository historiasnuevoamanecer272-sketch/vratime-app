import { contactsToMap, normalizeContacts, validateContacts } from '../src/lib/contacts.js';

const contacts = normalizeContacts({ viber: '+382 67 123 456', wa: '+382 67 222 333', tg: 'https://t.me/vratime_user' });
if (contacts.length !== 3) throw new Error('Expected all selected messengers to be preserved');
if (contacts.find((contact) => contact.messenger_type === 'tg')?.contact_value !== '@vratime_user') throw new Error('Telegram URL was not normalized to an alias');
if (validateContacts(contactsToMap(contacts))) throw new Error('Valid contact set was rejected');
if (validateContacts({ viber: '', wa: '', tg: '@bad' }) !== 'telegramInvalid') throw new Error('Invalid Telegram alias was accepted');

process.stdout.write('Multi-messenger and Telegram-alias checks passed.\n');
