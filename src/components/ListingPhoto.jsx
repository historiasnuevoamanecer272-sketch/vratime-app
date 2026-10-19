import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import MediaPreview from './MediaPreview';

export default function ListingPhoto({ src, alt = '', className = '', active = true }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={`listing-photo-button ${className}`} aria-label={t('mediaExperience.preview')} title={t('mediaExperience.preview')} onClick={(event) => { event.stopPropagation(); setOpen(true); }}><img src={src} alt={alt} /></button>
    {open && active ? <MediaPreview src={src} alt={alt} active={active} onClose={() => setOpen(false)} /> : null}
  </>;
}
