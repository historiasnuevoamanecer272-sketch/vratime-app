import { useRef, useState } from 'react';
import { useAppOverlay } from '../hooks/useAppNavigation';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { friendlyError } from '../lib/userErrors';
import { useTranslation } from 'react-i18next';
import { createReport } from '../lib/api';
import { showToast } from '../lib/toast';
import Icon from './Icon';

export default function ReportDialog({ targetKind, targetId, label, onClose, active = true }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('no_show');
  const [details, setDetails] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const dialogRef = useRef(null);
  const requestClose = () => { if (busy.current) return false; onClose(); return true; };
  useAppOverlay(active, requestClose, 'report');
  const dialogFocus = useDialogFocus({open:active,onClose:requestClose,dialogRef});
  const submit = async () => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      await createReport({ targetKind, targetId, reason, details: details.trim() });
      showToast(t('workflow.reportSent'), 'success', { prominent: true });
      onClose();
    } catch (error) {
      showToast(friendlyError(error, t), 'error');
    } finally {
      busy.current = false; setSaving(false);
    }
  };
  return <div className="modal-backdrop grid place-items-end sm:place-items-center p-0 sm:p-5"><section ref={dialogRef} {...dialogFocus} className="report-dialog card" aria-label={t('workflow.report')}><div className="section-head"><div><p className="eyebrow text-sea">VratiMe</p><h2 className="font-display text-2xl text-forest">{t('workflow.report')}</h2><small>{label}</small></div><button type="button" className="icon-button" disabled={saving} onClick={requestClose} aria-label={t('common.close')}><Icon name="close" size={18} /></button></div><label className="mt-4 block"><span className="field-label">{t('workflow.reportReason')}</span><select className="field" value={reason} onChange={(event) => setReason(event.target.value)}><option value="no_show">{t('workflow.reasonNoShow')}</option><option value="misleading">{t('workflow.reasonMisleading')}</option><option value="safety">{t('workflow.reasonSafety')}</option><option value="spam">{t('workflow.reasonSpam')}</option><option value="other">{t('workflow.reasonOther')}</option></select></label><label className="mt-4 block"><span className="field-label">{t('workflow.details')}</span><textarea className="field min-h-28 resize-y py-3" maxLength={2000} value={details} onChange={(event) => setDetails(event.target.value)} /></label><button type="button" className="btn-primary mt-5 w-full" disabled={saving} onClick={submit}>{saving ? t('onboarding.saving') : t('workflow.sendReport')}</button></section></div>;
}
