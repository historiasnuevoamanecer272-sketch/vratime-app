import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAppOverlay } from '../hooks/useAppNavigation';
import { useDialogFocus } from '../hooks/useDialogFocus';
import Icon from './Icon';
import '../styles/media-ux.css';

function MediaDialog({ children, title, onClose, active = true, fullScreen = false }) {
  const dialogRef = useRef(null);
  useAppOverlay(active, onClose, 'media-preview');
  useDialogFocus({ open: active, onClose, dialogRef });
  if (!active) return null;
  const content = <div className={`media-dialog-backdrop${fullScreen ? ' media-preview-backdrop' : ''}`}><section ref={dialogRef} className={`media-dialog${fullScreen ? ' media-preview-dialog' : ''}`} role="dialog" aria-modal="true" aria-label={title}>{children}</section></div>;
  return globalThis.document?.body ? createPortal(content,document.body) : content;
}

export default function MediaPreview({ src, alt = '', onClose, active = true }) {
  const { t } = useTranslation();
  return <MediaDialog active={active} fullScreen title={t('mediaExperience.preview')} onClose={onClose}><div className="media-preview-toolbar"><button type="button" className="btn-secondary media-preview-close" onClick={onClose}><Icon name="close" size={24} /><span>{t('mediaExperience.closePreview')}</span></button></div><img className="media-full-preview" src={src} alt={alt} draggable={false} /></MediaDialog>;
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
