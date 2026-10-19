import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppOverlay } from '../hooks/useAppNavigation';
import { useDialogFocus } from '../hooks/useDialogFocus';
import '../styles/media-ux.css';

function MediaDialog({ children, title, onClose, active = true }) {
  const dialogRef = useRef(null);
  useAppOverlay(active, onClose, 'media-preview');
  useDialogFocus({ open: active, onClose, dialogRef });
  if (!active) return null;
  return <div className="media-dialog-backdrop"><section ref={dialogRef} className="media-dialog" role="dialog" aria-modal="true" aria-label={title}>{children}</section></div>;
}

export default function MediaPreview({ src, alt = '', onClose, active = true }) {
  const { t } = useTranslation();
  return <MediaDialog active={active} title={t('mediaExperience.preview')} onClose={onClose}><button type="button" className="btn-secondary" onClick={onClose}>{t('mediaExperience.closePreview')}</button><img className="media-full-preview" src={src} alt={alt} /></MediaDialog>;
}

export function AvatarCrop({ file, onApply, onClose, saving, error, active = true }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState('');
  const [crop, setCrop] = useState({ zoom: 1, x: 0.5, y: 0.5 });
  useEffect(() => {
    if (!active) return undefined;
    const url = URL.createObjectURL(file);
    const frame = window.requestAnimationFrame(() => setPreview(url));
    return () => { window.cancelAnimationFrame(frame); URL.revokeObjectURL(url); };
  }, [file, active]);
  return <MediaDialog active={active} title={t('mediaExperience.cropTitle')} onClose={onClose}><div className="section-head"><h2>{t('mediaExperience.cropTitle')}</h2><button type="button" className="btn-link" disabled={saving} onClick={onClose}>{t('common.cancel')}</button></div><p>{t('mediaExperience.cropHint')}</p><div className="avatar-crop-preview">{preview ? <img src={preview} alt="" style={{ objectPosition: `${crop.x * 100}% ${crop.y * 100}%`, transform: `scale(${crop.zoom})`, transformOrigin: `${crop.x * 100}% ${crop.y * 100}%` }} /> : null}</div>{[['zoom', 1, 3], ['x', 0, 1], ['y', 0, 1]].map(([field, min, max]) => <label key={field} className="media-crop-control"><span>{t(`mediaExperience.${field === 'x' ? 'horizontal' : field === 'y' ? 'vertical' : 'zoom'}`)}</span><input type="range" min={min} max={max} step="0.01" value={crop[field]} disabled={saving} onChange={(event) => setCrop((current) => ({ ...current, [field]: Number(event.target.value) }))} /></label>)}{error ? <p className="field-error" role="alert">{t(error)}</p> : null}<button type="button" className="btn-primary w-full" disabled={saving} onClick={() => onApply(crop)}>{t(saving ? 'onboarding.saving' : 'mediaExperience.apply')}</button></MediaDialog>;
}
