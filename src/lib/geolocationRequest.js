const errorReason = (error) => error?.code === 1 ? 'positionDenied' : error?.code === 3 ? 'positionTimeout' : 'positionUnavailable';

// Browsers cannot cancel getCurrentPosition. Cancel invalidates its callbacks;
// the watchdog also bounds permission/provider stalls outside the native timeout.
export function requestBrowserLocation({
  onSuccess, onError, geolocation = globalThis.navigator?.geolocation,
  secureContext = globalThis.isSecureContext !== false,
  policy = globalThis.document?.permissionsPolicy || globalThis.document?.featurePolicy,
  setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout,
}) {
  let closed = false, attempt = 0, watchdog;
  const cancel = () => { closed = true; clearTimer(watchdog); };
  const finish = (reason, coordinates) => {
    if (closed) return;
    cancel();
    if (coordinates) onSuccess(coordinates); else onError(reason);
  };
  if (!secureContext) { finish('positionInsecure'); return cancel; }
  if (!geolocation?.getCurrentPosition) { finish('positionUnsupported'); return cancel; }
  try { if (policy?.allowsFeature && !policy.allowsFeature('geolocation')) { finish('positionBlocked'); return cancel; } }
  catch { finish('positionBlocked'); return cancel; }
  watchdog = setTimer(() => finish('positionTimeout'), 8000);
  const request = (coarse) => {
    const token = ++attempt;
    const fail = (error) => {
      if (closed || token !== attempt) return;
      if (error?.code !== 1 && !coarse) request(true);
      else finish(errorReason(error));
    };
    try {
      geolocation.getCurrentPosition(({ coords } = {}) => {
        if (closed || token !== attempt) return;
        if (!Number.isFinite(coords?.latitude) || !Number.isFinite(coords?.longitude)
          || Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180) { fail({ code: 2 }); return; }
        finish(null, [coords.latitude, coords.longitude]);
      }, fail, { enableHighAccuracy: !coarse, timeout: coarse ? 2500 : 4500, maximumAge: 60000 });
    } catch (error) { finish(error?.name === 'SecurityError' ? 'positionBlocked' : 'positionUnavailable'); }
  };
  request(false);
  return cancel;
}
