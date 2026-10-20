import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as form from '../src/lib/listingForm.js';
import { createListingDraftStore } from '../src/lib/listingDraft.js';
import { normalizeContacts, validateContacts, contactHref } from '../src/lib/contacts.js';

const valid = { selected: { id: 1 }, form: { type: 'give', quantity: '4' }, photos: [], locationConfirmed: true };
const blockers = (values) => form.listingFormBlockers({ ...valid, form: { ...valid.form, ...values } });

test('optional weight blocks SQL zero, negative, rounded-zero and overflow values', () => {
  for (const weight_kg of ['0', '-1', '-0.1', '0.001', '0.004', '1000000', '999999.995', '1e100', 'Infinity', 'NaN']) {
    assert.ok(blockers({ weight_kg }).includes('weight'), weight_kg);
  }
  for (const weight_kg of ['', ' ', '0.01', '1', '123.45', '999999.99']) assert.ok(!blockers({ weight_kg }).includes('weight'), weight_kg);
});

test('loan lengths match SQL codepoints at both ends of the allowed range', () => {
  const loan = { ...valid, selected: null, photos: [{}], form: { type: 'lend', quantity: '1', item_name: 'Drill', description: 'Works well', loan_duration_days: '7' } };
  for (const [field, count, blocker, expected] of [['item_name', 2, 'loanName', true], ['item_name', 3, 'loanName', false], ['item_name', 100, 'loanName', false], ['item_name', 101, 'loanName', true], ['description', 4, 'loanDescription', true], ['description', 5, 'loanDescription', false], ['description', 500, 'loanDescription', false], ['description', 501, 'loanDescription', true]]) {
    for (const character of ['😀', '𠮷', 'a']) assert.equal(form.listingFormBlockers({ ...loan, form: { ...loan.form, [field]: character.repeat(count) } }).includes(blocker), expected, `${field}/${count}/${character}`);
  }
});

function draftFixture() {
  const memory = new Map(), images = new Map();
  const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  const photoStorage = { get: async key => images.get(key), set: async (key, value) => images.set(key, value), remove: async key => images.delete(key) };
  return { store: createListingDraftStore({ storage, photoStorage, now: () => 1000 }), images };
}

test('accepted pickup instructions and Unicode loan fields round trip without losing suffixes', async () => {
  const { store } = draftFixture();
  for (const pickup_time of ['x'.repeat(301), 'x'.repeat(299) + '😀', '😀'.repeat(1000), 'x'.repeat(5000)]) {
    const data = { form: { pickup_time, item_name: '😀'.repeat(100), description: '😀'.repeat(500) } };
    await store.save('user', null, data);
    const restored = await store.load('user');
    assert.equal(restored.data.form.pickup_time, pickup_time);
    assert.equal(restored.data.form.item_name, data.form.item_name);
    assert.equal(restored.data.form.description, data.form.description);
  }
});

test('corrupt media falls back to retained draft text and never rejects loading', async () => {
  const { store, images } = draftFixture();
  for (const invalid of [{}, 'bad', 123, null, [null], [{}], [{ file: {} }], [{ existing: true, preview: 'javascript:bad' }]]) {
    await store.save('user', null, { form: { description: 'Keep my text' }, address: 'Podgorica' });
    const key = [...images.keys()][0];
    images.set(key, { ...images.get(key), photos: invalid });
    const restored = await store.load('user');
    assert.equal(restored.data.form.description, 'Keep my text');
    assert.equal(restored.data.address, 'Podgorica');
    assert.deepEqual(restored.photos, []);
    assert.equal(restored.photosAvailable, false);
  }
});

test('database field rejection is distinct from media and connection failures', () => {
  assert.equal(typeof form.listingSubmissionErrorKey, 'function');
  for (const code of ['23514', '22003', '22001', '22P02', 'P0001']) assert.equal(form.listingSubmissionErrorKey({ code }), 'createExperience.invalidFields', code);
  assert.equal(form.listingSubmissionErrorKey({ code: 'unsupported' }), 'mediaExperience.errors.unsupported');
  assert.equal(form.listingSubmissionErrorKey({ code: 'form_auth_changed' }), 'mediaExperience.errors.authChanged');
  assert.equal(form.listingSubmissionErrorKey({ code: 'listing_publication_conflict' }), 'draftExperience.publicationConflict');
  assert.equal(form.listingSubmissionErrorKey(new Error('media_upload_failed')), 'mediaExperience.errors.upload');
});

test('WhatsApp and Viber reject text and normalize usable international numbers', () => {
  for (const channel of ['wa', 'viber']) {
    for (const value of ['abc', 'WhatsApp', 'hello@example.test', '---', '.......', '()()', 'Позвоните вечером', 'No phone number', '+0000000', '123', '+1234567890123456', '+382abc67123456']) {
      assert.equal(validateContacts({ [channel]: value }), 'contactInvalid', `${channel}/${value}`);
      assert.ok(validateContacts({ [channel]: value, tg: '@valid_user' }), 'An invalid extra channel still blocks save');
      assert.equal(contactHref({ messenger_type: channel, contact_value: value }), undefined, 'Invalid historic values must not create unusable links');
    }
    for (const [input, expected] of [['+382 67 123 456', '+38267123456'], ['00382 (67) 123-456', '+38267123456'], ['38267123456', '+38267123456'], ['+1 (202) 555-0101', '+12025550101'], ['+44 7700 900123', '+447700900123']]) {
      assert.equal(validateContacts({ [channel]: input }), '', input);
      const contact = normalizeContacts({ [channel]: input })[0];
      assert.equal(contact.contact_value, expected);
      assert.equal(contactHref(contact), channel === 'wa' ? `https://wa.me/${expected.slice(1)}` : `viber://chat?number=${expected}`);
    }
  }
  for (const value of ['@fixture_user', 'fixture_user', 'https://t.me/fixture_user', '+382 67 123 456']) assert.equal(validateContacts({ tg: value }), '', value);
});
