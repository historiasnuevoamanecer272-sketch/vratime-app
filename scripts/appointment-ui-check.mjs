import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'rolldown/utils';
import i18n from '../src/i18n/index.js';

if (!process.argv.includes('--timezone-fixture')) {
  let failed = false;
  for (const timezone of ['UTC', 'Europe/Budapest']) {
    try {
      process.stdout.write(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--timezone-fixture'], {
        env: { ...process.env, TZ: timezone }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      }));
    } catch (error) {
      failed = true;
      process.stdout.write(error.stdout || '');
      process.stderr.write(error.stderr || '');
    }
  }
  if (failed) throw new Error('Appointment UI checks failed.');
} else {
  // Render real components offline; only initial server data and the network boundary are replaced.
  const srcUrl = new URL('../src/', import.meta.url).href;
  const reactUrl = import.meta.resolve('react');
  const jsxRuntimeUrl = import.meta.resolve('react/jsx-runtime');
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.endsWith('/pages/MyDeals.jsx') && specifier === 'react') {
        return { url: 'vratime-test:my-deals-react', shortCircuit: true };
      }
      if (context.parentURL?.endsWith('/components/AppointmentCard.jsx') && specifier === 'react/jsx-runtime') {
        return { url: 'vratime-test:capture-buttons', shortCircuit: true };
      }
      if (context.parentURL?.startsWith(srcUrl) && specifier.startsWith('.')) {
        if (specifier === '../lib/api') {
          return { url: 'vratime-test:no-network-api', shortCircuit: true };
        }
        if (specifier === '../supabaseClient') return { url: 'vratime-test:no-supabase', shortCircuit: true };
        const base = new URL(specifier, context.parentURL);
        for (const extension of ['.js', '.jsx', '/index.js']) {
          const candidate = new URL(`${base.href}${extension}`);
          if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
        }
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === 'vratime-test:no-network-api') {
        return { format: 'module', shortCircuit: true, source: `
          export const calls = [];
          export const scheduleHandover = async (...args) => { calls.push({ method: 'schedule', args }); };
          export const setHandoverOutcome = async (...args) => { calls.push({ method: 'outcome', args }); };
          const forbidden = () => { throw new Error('Offline test must not call API'); };
          export const getMyDeals = forbidden, acceptDeal = forbidden, cancelBooking = forbidden,
            confirmHandover = forbidden, confirmLoanHandover = forbidden, confirmLoanReturn = forbidden,
            submitReview = forbidden, createReport = forbidden;
        ` };
      }
      if (url === 'vratime-test:no-supabase') {
        return { format: 'module', shortCircuit: true, source: "export const supabase = new Proxy({}, { get() { throw new Error('Offline test must not call Supabase'); } });" };
      }
      if (url === 'vratime-test:my-deals-react') {
        return { format: 'module', shortCircuit: true, source: `
          import * as React from ${JSON.stringify(reactUrl)};
          export * from ${JSON.stringify(reactUrl)};
          let deals = [], appointments = [], stateIndex = 0;
          export const setFixture = (nextDeals, nextAppointments) => { deals = nextDeals; appointments = nextAppointments; stateIndex = 0; };
          export const useState = (initial) => {
            const index = stateIndex++;
            return React.useState(index === 0 ? deals : index === 1 ? appointments : initial);
          };
        ` };
      }
      if (url === 'vratime-test:capture-buttons') {
        return { format: 'module', shortCircuit: true, source: `
          import { jsx as realJsx, jsxs as realJsxs } from ${JSON.stringify(jsxRuntimeUrl)};
          export { Fragment } from ${JSON.stringify(jsxRuntimeUrl)};
          export const buttons = [];
          const capture = (render, type, props, key) => {
            if (type === 'button') buttons.push(props);
            return render(type, props, key);
          };
          export const jsx = (...args) => capture(realJsx, ...args);
          export const jsxs = (...args) => capture(realJsxs, ...args);
        ` };
      }
      if (url.startsWith(srcUrl) && url.endsWith('.css')) return {format:'module',source:'export default {};',shortCircuit:true};
      if (url.startsWith(srcUrl) && /\.(webp|png)$/.test(url)) {
        return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(url)};` };
      }
      if (url.startsWith(srcUrl) && url.endsWith('.jsx')) {
        const result = transformSync(fileURLToPath(url), readFileSync(new URL(url), 'utf8'), { jsx: { runtime: 'automatic' } });
        assert.equal(result.errors.length, 0);
        return { format: 'module', source: result.code, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
  try {
    const { default: AppointmentCard } = await import('../src/components/AppointmentCard.jsx');
    const { default: MyDeals } = await import('../src/pages/MyDeals.jsx');
    const { setFixture } = await import('vratime-test:my-deals-react');
    const { buttons } = await import('vratime-test:capture-buttons');
    const { calls } = await import('vratime-test:no-network-api');
    const { appointmentTimeForSave, isAwaitingHandover, localAppointmentInput, nextDefaultAppointmentInput } = await import('../src/lib/appointments.js');
    const accepted = { transaction_id: 'deal-fixture', listing_type: 'lend', accepted_at: '2026-01-10T08:00:00Z' };
    const render = (deal, appointment) => renderToStaticMarkup(createElement(AppointmentCard, { deal, appointment }));
    const timezone = process.env.TZ;
    const cases = [
      ['winter', '2026-01-11T10:15:00+00:00', timezone === 'UTC' ? '2026-01-11T10:15' : '2026-01-11T11:15'],
      ['summer', '2026-07-11T10:15:00+00:00', timezone === 'UTC' ? '2026-07-11T10:15' : '2026-07-11T12:15'],
      ['next local day', '2026-07-11T23:15:00+00:00', timezone === 'UTC' ? '2026-07-11T23:15' : '2026-07-12T01:15'],
    ];
    const failures = [];
    const check = (name, action) => {
      try { action(); }
      catch (error) { failures.push(`${timezone}: ${name}: ${error.message.split('\n')[0]}`); }
    };
    const checkAsync = async (name, action) => {
      try { await action(); }
      catch (error) { failures.push(`${timezone}: ${name}: ${error.message.split('\n')[0]}`); }
    };
    await i18n.changeLanguage('en');
    for (const [season, scheduled_for, expected] of cases) {
      check(`${season} appointment uses local input time`, () => {
        const html = render(accepted, { id: 'appointment-fixture', scheduled_for, state: 'scheduled' });
        assert.equal(html.match(/\bvalue="([^"]+)"/)?.[1], expected);
        assert.match(html, /aria-label="[^"]+"/);
      });
      check(`${season} unchanged local input preserves instant`, () => {
        assert.equal(localAppointmentInput(scheduled_for), expected);
        assert.equal(appointmentTimeForSave(expected, scheduled_for), new Date(scheduled_for).toISOString());
      });
    }
    check('a changed local input is converted back to UTC', () => {
      assert.equal(appointmentTimeForSave('2026-07-12T12:15', cases[1][1]), timezone === 'UTC' ? '2026-07-12T12:15:00.000Z' : '2026-07-12T10:15:00.000Z');
    });
    check('unchanged time preserves seconds during the repeated autumn hour', () => {
      const local = timezone === 'UTC' ? '2026-10-25T01:30' : '2026-10-25T02:30';
      assert.equal(appointmentTimeForSave(local, '2026-10-25T01:30:42.123Z'), '2026-10-25T01:30:42.123Z');
    });
    for (const [name, instant, expected] of [
      ['winter default', '2026-01-10T10:45:00Z', timezone === 'UTC' ? '2026-01-11T10:00' : '2026-01-11T11:00'],
      ['summer default', '2026-07-10T10:45:00Z', timezone === 'UTC' ? '2026-07-11T10:00' : '2026-07-11T12:00'],
    ]) {
      check(`${name} is local`, () => assert.equal(nextDefaultAppointmentInput(new Date(instant)), expected));
    }
    check('invalid stored time falls back to a usable default', () => assert.equal(localAppointmentInput(undefined), ''));
    check('accepted handover shows the appointment', () => {
      assert.ok(isAwaitingHandover(accepted));
      assert.match(render(accepted), /type="datetime-local"/);
    });
    check('pending request keeps its 48-hour deadline without a meeting form', () => {
      const pending = { ...accepted, accepted_at: null, status: 'pending', expires_at: '2026-01-12T08:00:00Z' };
      assert.equal(Boolean(pending.expires_at && isAwaitingHandover(pending)), true);
      assert.equal(render(pending), '');
    });
    for (const [name, patch] of [
      ['handed over', { handed_over_at: '2026-01-10T09:00:00Z' }],
      ['returned', { returned_at: '2026-01-10T09:00:00Z' }],
      ['completed', { completed_at: '2026-01-10T09:00:00Z' }],
      ['canceled', { canceled_at: '2026-01-10T09:00:00Z' }],
      ['expired', { status: 'expired' }],
    ]) {
      check(`${name} cannot schedule or show the booking timer`, () => {
        assert.equal(isAwaitingHandover({ ...accepted, ...patch }), false);
        assert.equal(render({ ...accepted, ...patch }), '');
      });
    }
    const dealFixture = { ...accepted, role: 'giver', created_at: '2026-01-10T07:00:00Z', quantity: 1, partner_name: 'Fixture partner' };
    const oldMeeting = { id: 'old-completed', transaction_id: 'deal-fixture', state: 'completed', scheduled_for: '2026-01-11T10:15:00Z' };
    const currentMeeting = { id: 'new-scheduled', transaction_id: 'deal-fixture', state: 'scheduled', scheduled_for: '2026-07-11T10:15:00Z' };
    const renderDeals = (meetings, deal = dealFixture) => {
      buttons.length = 0;
      calls.length = 0;
      setFixture([deal], meetings);
      return renderToStaticMarkup(createElement(MyDeals));
    };
    await checkAsync('open meeting takes priority over older completed meeting and receives the outcome', async () => {
      const html = renderDeals([oldMeeting, currentMeeting]);
      assert.equal(html.match(/\bvalue="([^"]+)"/)?.[1], timezone === 'UTC' ? '2026-07-11T10:15' : '2026-07-11T12:15');
      const outcome = buttons.find((button) => button.children === 'Meeting completed');
      assert.ok(outcome);
      await outcome.onClick();
      assert.deepEqual(calls, [{ method: 'outcome', args: ['new-scheduled', 'completed'] }]);
    });
    await checkAsync('cancel meeting leaves the reservation intact and targets the open meeting', async () => {
      renderDeals([currentMeeting]);
      const cancel=buttons.find(item=>item.children==='Cancel meeting');
      assert.ok(cancel,'Open meeting needs an independent cancel action');
      await cancel.onClick();
      assert.deepEqual(calls,[{method:'outcome',args:['new-scheduled','canceled']}]);
    });
    await checkAsync('same-frame meeting clicks submit only one mutation', async () => {
      renderDeals([currentMeeting]);
      const button = buttons.find((item) => item.children === 'Reschedule');
      assert.ok(button);
      await Promise.all([button.onClick(), button.onClick()]);
      assert.equal(calls.length, 1, 'duplicate schedule request escaped synchronous guard');
    });
    for (const state of ['scheduled', 'reschedule_requested', 'no_show_reported']) {
      check(`${state} meeting takes priority over later history and other transactions`, () => {
        const html = renderDeals([
          { ...oldMeeting, scheduled_for: '2026-12-20T10:15:00Z' },
          { ...currentMeeting, state },
          { ...currentMeeting, id: 'foreign-open', transaction_id: 'another-deal', scheduled_for: '2027-01-10T10:15:00Z' },
        ]);
        assert.equal(html.match(/\bvalue="([^"]+)"/)?.[1], timezone === 'UTC' ? '2026-07-11T10:15' : '2026-07-11T12:15');
        assert.equal(buttons[0].children, 'Reschedule');
        assert.equal(buttons.length, 5);
      });
    }
    check('without an open meeting the latest historical state is displayed', () => {
      const html = renderDeals([{ ...currentMeeting, state: 'canceled' }, oldMeeting]);
      assert.match(html, /Meeting status: Canceled<\/p>/);
      assert.equal(buttons.length, 1);
      assert.equal(buttons[0].children, 'Schedule');
    });
    check('pending request renders its booking countdown without a meeting form', () => {
      const html = renderDeals([], { ...dealFixture, accepted_at: null, status: 'pending', expires_at: '2026-01-12T08:00:00Z' });
      assert.match(html, /class="deadline-countdown /);
      assert.ok(!html.includes('type="datetime-local"'));
    });
    for (const language of ['ru', 'me', 'en', 'fr', 'de']) {
      await i18n.changeLanguage(language);
      check(`loan terms appear only for lending in ${language}`, () => {
        const pending = { ...dealFixture, accepted_at: null, status: 'pending', expires_at: '2099-01-12T08:00:00Z' };
        const loanTerms = i18n.t('dealExperience.loanLimits');
        const loan = renderDeals([], { ...pending, listing_type: 'lend' });
        assert.ok(loan.includes(loanTerms), 'Lending should explain its return deadline');
        for (const listing_type of ['give', 'take']) {
          const ordinary = renderDeals([], { ...pending, listing_type });
          assert.ok(!ordinary.includes(loanTerms), 'Ordinary exchanges must not show loan terms');
        }
      });
    }
    await i18n.changeLanguage('en');
    check('handed-over loan hides booking countdown and keeps the return date', () => {
      const html = renderDeals([currentMeeting], {
        ...dealFixture, handed_over_at: '2026-07-11T10:15:00Z',
        expires_at: '2026-01-12T08:00:00Z', return_due_at: '2026-07-15T10:15:00Z',
      });
      assert.ok(!html.includes('class="deadline-countdown '));
      assert.ok(!html.includes('type="datetime-local"'));
      assert.ok(html.includes('Return by'));
    });
    for (const state of ['completed', 'canceled', 'no_show_confirmed']) {
      await checkAsync(`${state} meeting offers a new schedule without terminal outcome actions`, async () => {
        const originalNow = Date.now;
        Date.now = () => new Date('2026-07-10T10:45:00Z').getTime();
        let html;
        try { html = renderDeals([{ ...oldMeeting, state }]); }
        finally { Date.now = originalNow; }
        assert.equal(buttons.length, 1);
        assert.equal(buttons[0].children, 'Schedule');
        assert.equal(html.match(/\bvalue="([^"]+)"/)?.[1], timezone === 'UTC' ? '2026-07-11T10:00' : '2026-07-11T12:00');
        await buttons[0].onClick();
        assert.deepEqual(calls, [{ method: 'schedule', args: ['deal-fixture', '2026-07-11T10:00:00.000Z'] }]);
      });
    }
    const knownStates = ['scheduled', 'reschedule_requested', 'completed', 'no_show_reported', 'no_show_confirmed', 'canceled'];
    for (const language of ['ru', 'me', 'en', 'fr', 'de']) {
      await i18n.changeLanguage(language);
      for (const state of knownStates) {
        check(`${language} ${state} label is translated`, () => {
          const html = render(accepted, { id: 'appointment-fixture', scheduled_for: cases[0][1], state });
          const statusText = html.match(/<p\s[^>]*>(.*?)<\/p>/)?.[1] || '';
          const translationKey = `appointment.states.${state}`;
          const label = i18n.t(translationKey);
          assert.ok(statusText.length > 0);
          assert.notEqual(label, translationKey);
          assert.notEqual(label, state);
          assert.equal(statusText, i18n.t('appointment.state', { state: label }));
        });
      }
    }
    if (failures.length) throw new Error(failures.join('\n'));
    process.stdout.write(`Appointment UI passed (${timezone}): local UTC/DST times, request/loan deadlines, open/history selection and action IDs, terminal meetings, and 6 states in 5 languages.\n`);
  } finally {
    hooks.deregister();
  }
}
