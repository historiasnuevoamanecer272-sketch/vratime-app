import assert from 'node:assert/strict';
import { composeFeedback } from '../src/lib/feedbackSubmission.js';
assert.deepEqual(composeFeedback('  Есть идея  ', ''), { message: 'Есть идея', error: null });
assert.equal(composeFeedback('Есть идея', ' @test_user ').message, 'Есть идея\n\nКонтакт для ответа / Reply contact: @test_user');
assert.equal(composeFeedback('Есть идея', 'a'.repeat(141)).error, 'feedbackExperience.contactTooLong');
assert.equal(composeFeedback('a'.repeat(2990), '@test_user').error, 'feedbackExperience.messageTooLong');
assert.ok(!composeFeedback('Есть идея', 'mail@example.com\nowner: fake').message.includes('\nowner:'));
console.log('PASS: optional feedback contact, explicit inclusion and bounded combined message');
