import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPushPublicConfig, registerPushSubscription, disablePushSubscription, getMyPushStatus } from '../lib/api';
import { disablePushPreference, enablePushPreference, pushSupport, readPushPreference } from '../lib/pushPreferences';

const api = { registerPushSubscription, disablePushSubscription, getMyPushStatus };
export default function PushPreferences({ userId }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState({ state: 'loading', enabled: false });
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const operation = useRef(0);
  const request = useRef(null);
  const mutex = useRef(false);
  const load = useCallback(async () => {
    const revision = ++operation.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const isCurrent = () => operation.current === revision && !controller.signal.aborted;
    setStatus({ state: 'loading', enabled: false });
    const support = pushSupport();
    if (support !== 'supported') { setStatus({ state: support, enabled: false }); return; }
    try {
      const nextConfig = await getPushPublicConfig();
      if (!isCurrent()) return;
      setConfig(nextConfig);
      const next = await readPushPreference({ userId, api, isCurrent, signal: controller.signal });
      if (isCurrent()) setStatus(nextConfig.configured ? next : { state: 'notConfigured', enabled: false });
    } catch { if (isCurrent()) setStatus({ state: 'error', enabled: false }); }
  }, [userId]);
  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => { window.clearTimeout(timer); operation.current += 1; request.current?.abort(); };
  }, [load]);
  const change = async () => {
    if (mutex.current) return;
    mutex.current = true; setBusy(true);
    const revision = ++operation.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const isCurrent = () => operation.current === revision && !controller.signal.aborted;
    try {
      const action = status.enabled ? disablePushPreference : enablePushPreference;
      const next = await action({ userId, api, config, isCurrent, signal: controller.signal });
      if (isCurrent()) setStatus(next);
    } catch { if (isCurrent()) setStatus({ state: 'error', enabled: false }); }
    finally { mutex.current = false; if (isCurrent()) setBusy(false); }
  };
  const blocked = ['loading', 'unsupported', 'installRequired', 'denied', 'workerUnavailable', 'notConfigured', 'error'].includes(status.state);
  return <div className="mt-5 border-t border-current/10 pt-4">
    <h3 className="font-bold text-forest">{t('pushExperience.title')}</h3>
    <p className="mt-2 text-sm leading-6 text-muted">{t('pushExperience.explanation')}</p>
    <p className="mt-2 text-sm font-semibold" role="status">{t(`pushExperience.${status.state}`)}</p>
    {status.failed_count > 0 ? <p className="mt-2 text-sm text-muted">{t('pushExperience.deliveryFailure')}</p> : null}
    {status.last_accepted_at ? <p className="mt-2 text-xs text-muted">{t('pushExperience.lastAccepted', { time: new Date(status.last_accepted_at).toLocaleString() })}</p> : null}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className="btn-secondary" disabled={busy || (!status.enabled && blocked)} onClick={change}>{t(busy ? 'common.loading' : status.enabled ? 'pushExperience.disable' : 'pushExperience.enable')}</button>
      {['error', 'workerUnavailable', 'notConfigured'].includes(status.state) || status.enabled ? <button type="button" className="btn-link" disabled={busy} onClick={load}>{t('common.retry')}</button> : null}
    </div>
  </div>;
}
