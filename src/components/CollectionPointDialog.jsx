import { useRef, useState } from 'react';
import { useAppOverlay } from '../hooks/useAppNavigation';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { friendlyError } from '../lib/userErrors';
import { validPosition } from '../lib/locationValidation';
import { useTranslation } from 'react-i18next';
import { createCollectionPoint } from '../lib/api';
import { collectionPointTypeKeys, collectionPointTypeLabel } from '../lib/collectionPointTypes';
import { getAppLanguage } from '../i18n';
import { showToast } from '../lib/toast';
import Icon from './Icon';

export default function CollectionPointDialog({ initialPosition = [42.441, 19.263], onClose, onCreated, active = true }) {
  const { t } = useTranslation();
  const language = getAppLanguage();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => {
    const position = validPosition(initialPosition) ? initialPosition.map(Number) : [42.441, 19.263];
    return { name: '', locationLabel: '', description: '', lat: position[0], lng: position[1], materials: [] };
  });
  const toggleMaterial = (key) => setForm((current) => ({ ...current, materials: current.materials.includes(key) ? current.materials.filter((item) => item !== key) : [...current.materials, key] }));
  const useLocation = () => navigator.geolocation?.getCurrentPosition(({ coords }) => setForm((current) => ({ ...current, lat: coords.latitude, lng: coords.longitude })), () => showToast(t('map.locationDenied'), 'error'), { enableHighAccuracy: true, timeout: 10000 });
  const busy = useRef(false);
  const dialogRef = useRef(null);
  const requestClose = () => { if (busy.current) return false; onClose(); return true; };
  useAppOverlay(active, requestClose, 'collection-point');
  const dialogFocus = useDialogFocus({open:active,onClose:requestClose,dialogRef});
  const submit = async () => {
    if (busy.current) return;
    if (form.name.trim().length < 2 || form.locationLabel.trim().length < 3 || !form.materials.length) return showToast(t('points.required'), 'error');
    if (!validPosition([form.lat, form.lng])) return showToast(t('points.invalidCoordinates'), 'error');
    busy.current = true; setSaving(true);
    try {
      await createCollectionPoint({ ...form, name: form.name.trim(), locationLabel: form.locationLabel.trim(), description: form.description.trim() || null });
      showToast(t('points.created'), 'success', { prominent: true });
      await onCreated?.(); onClose();
    } catch (error) { showToast(friendlyError(error, t), 'error'); }
    finally { busy.current = false; setSaving(false); }
  };
  return <div className="modal-backdrop grid place-items-end sm:place-items-center"><section ref={dialogRef} {...dialogFocus} className="collection-point-dialog card" aria-label={t('points.add')}><button type="button" className="icon-button ml-auto" disabled={saving} onClick={requestClose} aria-label={t('common.close')}><Icon name="close" size={18} /></button><p className="eyebrow text-sea">VratiMe</p><h2 className="font-display mt-1 text-3xl text-forest">{t('points.add')}</h2><p className="mt-2 text-sm text-muted">{t('points.addText')}</p><label className="mt-4 block"><span className="field-label">{t('points.name')}</span><input className="field" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label><label className="mt-4 block"><span className="field-label">{t('points.address')}</span><input className="field" value={form.locationLabel} onChange={(event) => setForm((current) => ({ ...current, locationLabel: event.target.value }))} /></label><div className="mt-4 grid grid-cols-2 gap-3"><label><span className="field-label">{t('points.latitude')}</span><input className="field" type="number" step="0.000001" value={form.lat} onChange={(event) => setForm((current) => ({ ...current, lat: event.target.value }))} /></label><label><span className="field-label">{t('points.longitude')}</span><input className="field" type="number" step="0.000001" value={form.lng} onChange={(event) => setForm((current) => ({ ...current, lng: event.target.value }))} /></label></div><button type="button" className="btn-secondary mt-3" onClick={useLocation}><Icon name="location" size={16} />{t('map.nearby')}</button><fieldset className="mt-4"><legend className="field-label">{t('points.materials')}</legend><div className="point-material-options">{collectionPointTypeKeys.map((key) => <label key={key}><input type="checkbox" checked={form.materials.includes(key)} onChange={() => toggleMaterial(key)} /><span>{collectionPointTypeLabel(key, language)}</span></label>)}</div></fieldset><label className="mt-4 block"><span className="field-label">{t('create.description')}</span><textarea className="field min-h-20 py-3" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label><div className="mt-5 grid grid-cols-2 gap-3"><button type="button" className="btn-secondary" disabled={saving} onClick={requestClose}>{t('common.cancel')}</button><button type="button" className="btn-primary" disabled={saving} onClick={submit}>{saving ? t('onboarding.saving') : t('points.publish')}</button></div></section></div>;
}
