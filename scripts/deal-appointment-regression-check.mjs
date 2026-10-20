import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { nextDealStep } from '../src/lib/dealNextStep.js';
import { loanPhase } from '../src/lib/lending.js';

const now = new Date('2026-10-20T12:00:00Z');
const accepted = { accepted_at: '2026-10-20T11:00:00Z', status: 'reserved', expires_at: '2026-10-20T13:00:00Z' };
const failures = [];
const check = (name, action) => {
  try { action(); }
  catch (error) { failures.push(`${name}: ${error.message}`); }
};

for (const listing_type of ['give', 'take', 'lend']) {
  for (const role of ['giver', 'taker']) {
    const deal = { ...accepted, listing_type, role };
    for (const scheduled_for of ['2026-10-20T11:00:00Z', '2026-10-20T13:00:00Z']) {
      for (const [state, expected] of [['completed', 'confirmTransfer'], ['reschedule_requested', 'arrangeMeeting'], ['no_show_reported', 'arrangeMeeting']]) {
        check(`${listing_type}/${role}/${state}/${scheduled_for}`, () => {
          assert.equal(nextDealStep(deal, { state, scheduled_for }, now), expected);
        });
      }
    }
  }
}

for (const [patch, expected] of [
  [{ status: 'pending' }, 'pending'],
  [{ status: 'reserved', accepted_at: accepted.accepted_at }, 'reserved'],
  [{ status: 'confirming', accepted_at: accepted.accepted_at, giver_confirmed_at: accepted.accepted_at }, 'confirming'],
  [{ status: 'confirming', accepted_at: accepted.accepted_at, taker_confirmed_at: accepted.accepted_at }, 'confirming'],
  [{ accepted_at: accepted.accepted_at }, 'reserved'],
  [{}, 'pending'],
  [{ status: 'expired' }, 'expired'],
  [{ status: 'expired', canceled_at: accepted.accepted_at, canceled_reason: 'expired' }, 'expired'],
  [{ status: 'canceled', canceled_at: accepted.accepted_at }, 'canceled'],
]) {
  check(`loan status ${JSON.stringify(patch)}`, () => assert.equal(loanPhase({ listing_type: 'lend', ...patch }, now), expected));
}

for (const [zone, gap, before, beforeUtc, after, afterUtc, repeated, repeatedUtc] of [
  ['Europe/Budapest', '2026-03-29T02:30', '2026-03-29T01:30', '2026-03-29T00:30:00.000Z', '2026-03-29T03:30', '2026-03-29T01:30:00.000Z', '2026-10-25T02:30', '2026-10-25T01:30:42.123Z'],
  ['America/New_York', '2026-03-08T02:30', '2026-03-08T01:30', '2026-03-08T06:30:00.000Z', '2026-03-08T03:30', '2026-03-08T07:30:00.000Z', '2026-11-01T01:30', '2026-11-01T06:30:42.123Z'],
]) {
  check(`${zone} rejects skipped wall time and preserves real instants`, () => {
    execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { appointmentTimeForSave } from ${JSON.stringify(new URL('../src/lib/appointments.js', import.meta.url).href)};
      assert.throws(() => appointmentTimeForSave(${JSON.stringify(gap)}), { code: 'appointment_invalid_time' });
      assert.equal(appointmentTimeForSave(${JSON.stringify(before)}), ${JSON.stringify(beforeUtc)});
      assert.equal(appointmentTimeForSave(${JSON.stringify(after)}), ${JSON.stringify(afterUtc)});
      assert.equal(appointmentTimeForSave(${JSON.stringify(repeated)}, ${JSON.stringify(repeatedUtc)}), ${JSON.stringify(repeatedUtc)});
      assert.throws(() => appointmentTimeForSave(''), { code: 'appointment_invalid_time' });
      assert.throws(() => appointmentTimeForSave('2026-02-30T12:00'), { code: 'appointment_invalid_time' });
    `], { env: { ...process.env, TZ: zone }, stdio: 'pipe' });
  });
}

assert.deepEqual(failures, [], 'Deal/appointment regressions');
console.log('Deal/appointment regressions passed: meeting outcomes, loan badges/expiry and skipped/repeated DST hours in two zones.');
