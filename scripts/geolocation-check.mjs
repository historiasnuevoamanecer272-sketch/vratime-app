import assert from 'node:assert/strict';
import { mapExperienceTranslations } from '../src/i18n/uxMap.js';
const subject = await import('../src/lib/geolocationRequest.js').catch(() => ({}));
assert.equal(typeof subject.requestBrowserLocation, 'function', 'Geolocation requests need bounded fallback and distinct errors');
const fixture = (extra = {}) => {
  const calls = [], outcomes = [], timers = new Map(); let timerId = 0;
  const cancel = subject.requestBrowserLocation({
    geolocation: { getCurrentPosition(success, error, options) { calls.push({ success, error, options }); } },
    secureContext: true, policy: null,
    setTimer(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimer(id) { timers.delete(id); },
    onSuccess: coords => outcomes.push({ coords }), onError: reason => outcomes.push({ reason }), ...extra,
  });
  return { calls, outcomes, timers, cancel };
};
const success = { coords: { latitude: 42.44, longitude: 19.26 } };
{
  const f = fixture(); assert.equal(f.calls[0].options.enableHighAccuracy, true); assert.ok(f.calls[0].options.timeout <= 5000);
  f.calls[0].error({ code: 3 }); assert.equal(f.calls.length, 2); assert.equal(f.calls[1].options.enableHighAccuracy, false);
  f.calls[1].success(success); f.calls[0].success({ coords: { latitude: 1, longitude: 2 } });
  assert.deepEqual(f.outcomes, [{ coords: [42.44, 19.26] }]); assert.equal(f.timers.size, 0);
}
for (const [code, reason] of [[1, 'positionDenied'], [2, 'positionUnavailable'], [3, 'positionTimeout']]) {
  const f = fixture(); f.calls[0].error({ code });
  if (code !== 1) f.calls[1].error({ code });
  assert.equal(f.calls.length, code === 1 ? 1 : 2); assert.deepEqual(f.outcomes, [{ reason }]); assert.equal(f.timers.size, 0);
}
{
  const f = fixture(); assert.equal(f.timers.size, 1);
  const timer = [...f.timers.values()][0]; assert.ok(timer.delay <= 8000); timer.callback();
  f.calls[0].success(success); assert.deepEqual(f.outcomes, [{ reason: 'positionTimeout' }]);
}
{
  const f = fixture(); f.cancel(); f.calls[0].success(success); f.calls[0].error({ code: 2 });
  assert.equal(f.calls.length, 1); assert.equal(f.outcomes.length, 0); assert.equal(f.timers.size, 0);
}
for (const [extra, reason] of [[{ geolocation: null }, 'positionUnsupported'], [{ secureContext: false }, 'positionInsecure'], [{ policy: { allowsFeature: () => false } }, 'positionBlocked']]) {
  const f = fixture(extra); assert.equal(f.calls.length, 0); assert.deepEqual(f.outcomes, [{ reason }]);
}
{
  const f = fixture({ policy: { allowsFeature() { throw new Error('Unsupported policy probe'); } } });
  assert.equal(f.calls.length, 0); assert.deepEqual(f.outcomes, [{ reason: 'positionBlocked' }]);
}
{
  const f = fixture(); f.calls[0].success({ coords: { latitude: NaN, longitude: 19.26 } });
  assert.equal(f.calls.length, 2); f.calls[1].success({ coords: { latitude: 91, longitude: 19.26 } });
  assert.deepEqual(f.outcomes, [{ reason: 'positionUnavailable' }]);
}
for (const language of ['ru', 'me', 'en', 'fr', 'de']) for (const key of ['positionDenied', 'positionUnavailable', 'positionTimeout', 'positionUnsupported', 'positionInsecure', 'positionBlocked', 'positionManualHint']) assert.ok(mapExperienceTranslations[language][key]?.trim(), `${language}.${key} needs its own copy`);
console.log('Geolocation checks passed: real-coordinate validation, bounded fallback/deadline, distinct errors, no retry after denial, cancellation and stale callbacks.');
