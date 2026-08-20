import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { supabase } from '../supabaseClient';
import { categoryLabel } from '../lib/categories';
import { getAppLanguage } from '../i18n';
import { showToast } from '../lib/toast';
import Icon from '../components/Icon';
import CategoryIcon from '../components/CategoryIcon';

const bucket = 'LISTING-PHOTOS';
const markerIcon = new L.Icon({ iconUrl: new URL('../assets/pins/pin-give.png', import.meta.url).href, iconSize: [38, 46], iconAnchor: [19, 46] });

function LocationPicker({ position, onChange }) {
  useMapEvents({ click: ({ latlng }) => onChange([latlng.lat, latlng.lng]) });
  return <Marker position={position} icon={markerIcon} />;
}

function MapMover({ position }) {
  const map = useMap();
  useEffect(() => map.flyTo(position, 14, { duration: 0.7 }), [map, position]);
  return null;
}

export default function CreateListing({ userId, onBack, onSuccess }) {
  const { t } = useTranslation();
  const language = getAppLanguage();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [trail, setTrail] = useState([]);
  const [selected, setSelected] = useState(null);
  const [position, setPosition] = useState([42.441, 19.263]);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [form, setForm] = useState({ type: 'give', quantity: 1, description: '' });

  useEffect(() => {
    let active = true;
    supabase.from('categories').select('*').order('id').then(({ data, error }) => {
      if (!active) return;
      setCategories(data || []); setCategoriesLoading(false);
      if (error) showToast(`${t('errors.load')} ${error.message}`, 'error');
    });
    return () => { active = false; };
  }, [t]);

  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);

  const parent = trail.at(-1);
  const visibleCategories = useMemo(() => categories.filter((item) => parent ? item.parent_id === parent.id : item.parent_id === null), [categories, parent]);
  const getPath = (items) => items.at(-1)?.category_path || items.map((item) => item.slug).join('/');

  const chooseCategory = (item) => {
    const children = categories.some((category) => category.parent_id === item.id);
    if (children) return setTrail((current) => [...current, item]);
    setSelected({ ...item, category_path: getPath([...trail, item]) });
    setStep(3);
  };

  const goBack = () => {
    if (step === 3) return setStep(2);
    if (step === 2 && trail.length) return setTrail((current) => current.slice(0, -1));
    if (step === 2) return setStep(1);
    onBack();
  };

  const selectPhoto = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return showToast(t('create.badFile'), 'error');
    if (file.size > 5 * 1024 * 1024) return showToast(t('create.tooLarge'), 'error');
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhoto(file); setPhotoPreview(URL.createObjectURL(file));
  };

  const useLocation = () => {
    if (!navigator.geolocation) return showToast(t('map.locationMissing'), 'error');
    navigator.geolocation.getCurrentPosition(({ coords }) => setPosition([coords.latitude, coords.longitude]), () => showToast(t('map.locationDenied'), 'error'), { enableHighAccuracy: true, timeout: 10000 });
  };

  const publish = async () => {
    if (!selected || form.quantity < 1) return;
    setLoading(true);
    let uploadedPath = '';
    try {
      if (!userId) throw new Error('No user');
      let imageUrl = null;
      if (photo) {
        const extension = photo.name.split('.').pop()?.toLowerCase() || 'jpg';
        uploadedPath = `${userId}/listings/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from(bucket).upload(uploadedPath, photo, { contentType: photo.type, upsert: false, cacheControl: '3600' });
        if (uploadError) throw uploadError;
        imageUrl = supabase.storage.from(bucket).getPublicUrl(uploadedPath).data.publicUrl;
      }
      const { error } = await supabase.from('listings').insert({
        user_id: userId, type: form.type, status: 'active', category_id: selected.id,
        category: categoryLabel(selected, 'ru'), category_path: selected.category_path,
        description: form.description.trim() || null, image_url: imageUrl, quantity: Number(form.quantity),
        lat: position[0], lng: position[1],
      });
      if (error) throw error;
      showToast(t('create.published'), 'success');
      window.dispatchEvent(new Event('listings-updated'));
      onSuccess();
    } catch (error) {
      if (uploadedPath) await supabase.storage.from(bucket).remove([uploadedPath]);
      showToast(`${t('errors.save')} ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="wizard-shell">
        <header className="wizard-header">
          <button type="button" className="btn-ghost min-h-10 px-3 text-sm" onClick={goBack}><Icon name="arrowLeft" size={17} />{t('common.back')}</button>
          <div className="text-right"><p className="eyebrow text-sea">{t('create.title')}</p><p className="mt-1 text-sm font-extrabold text-forest">{t('create.step', { step })}</p></div>
          <div className="wizard-progress col-span-2">{[1, 2, 3].map((value) => <span key={value} className={value <= step ? 'active' : ''} />)}</div>
        </header>

        <main className="wizard-content">
          {step === 1 ? <section>
            <p className="eyebrow text-sea">{t('create.typeEyebrow')}</p><h1 className="font-display mt-2 text-4xl text-forest">{t('create.typeTitle')}</h1>
            <div className="mt-7 space-y-3">
              {[['give', 'gift'], ['take', 'truck']].map(([value, icon]) => <button key={value} type="button" className={`choice-card ${value}`} onClick={() => { setForm((current) => ({ ...current, type: value })); setStep(2); }}><span className="choice-icon"><Icon name={icon} size={29} /></span><span><strong>{t(`create.${value}`)}</strong><small>{t(`create.${value}Text`)}</small></span><Icon name="arrowRight" size={20} /></button>)}
            </div>
          </section> : null}

          {step === 2 ? <section>
            <p className="eyebrow text-sea">{t('create.categoryEyebrow')}</p><h1 className="font-display mt-2 text-4xl text-forest">{t('create.categoryTitle')}</h1>
            <div className="scroll-row mt-4 flex gap-2 overflow-x-auto pb-1"><button type="button" className={`chip ${trail.length === 0 ? 'chip-active' : ''}`} onClick={() => setTrail([])}>{t('create.root')}</button>{trail.map((item, index) => <button key={item.id} type="button" className="chip chip-active" onClick={() => setTrail((current) => current.slice(0, index + 1))}>{categoryLabel(item, language)}</button>)}</div>
            {categoriesLoading ? <div className="state-card mt-5">{t('create.loadingCategories')}</div> : visibleCategories.length ? <div className="category-grid mt-5">{visibleCategories.map((item) => <button type="button" className="category-card" key={item.id} onClick={() => chooseCategory(item)}><span className="category-icon"><CategoryIcon category={item} size={31} /></span><strong>{categoryLabel(item, language)}</strong><small>{categories.some((child) => child.parent_id === item.id) ? t('create.open') : t('common.choose')}</small></button>)}</div> : <div className="state-card mt-5">{t('create.noCategories')}</div>}
          </section> : null}

          {step === 3 ? <section className="pb-28">
            <p className="eyebrow text-sea">{t('create.publishEyebrow')}</p><h1 className="font-display mt-2 text-4xl text-forest">{t('create.publishTitle')}</h1><p className="mt-3 text-sm leading-6 text-muted">{t('create.publishText')}</p>
            <div className="detail-card mt-5">
              <div className="flex items-center gap-3"><span className="icon-tile"><Icon name="camera" size={22} /></span><div className="min-w-0 flex-1"><strong className="block text-forest">{t('create.photo')}</strong><small className="block truncate text-muted">{photo?.name || t('common.optional')}</small></div><label className="btn-secondary min-h-10 cursor-pointer px-4 text-sm">{t('create.upload')}<input type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={selectPhoto} /></label></div>
              {photoPreview ? <div className="photo-preview"><img src={photoPreview} alt="" /><button type="button" className="btn-link" onClick={() => { URL.revokeObjectURL(photoPreview); setPhoto(null); setPhotoPreview(''); }}>{t('common.remove')}</button></div> : null}
            </div>
            <label className="mt-4 block"><span className="field-label">{t('create.quantity')}</span><input className="field" type="number" min="1" max="10000" inputMode="numeric" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: Math.max(1, Number(event.target.value) || 1) }))} /></label>
            <label className="mt-4 block"><span className="field-label">{t('create.description')}</span><textarea className="field min-h-24 resize-y py-3" maxLength={500} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
            <div className="mt-4 flex justify-end"><button type="button" className="btn-secondary min-h-10 px-4 text-sm" onClick={useLocation}><Icon name="location" size={16} />{t('create.useLocation')}</button></div>
            <div className="mini-map mt-3"><MapContainer center={position} zoom={13} zoomControl={false} className="h-full w-full"><TileLayer attribution="&copy; OpenStreetMap &copy; CARTO" url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" /><MapMover position={position} /><LocationPicker position={position} onChange={setPosition} /></MapContainer></div>
          </section> : null}
        </main>

        {step === 3 ? <footer className="wizard-footer"><button type="button" className="btn-primary w-full" disabled={loading} onClick={publish}><Icon name={form.type === 'give' ? 'gift' : 'truck'} size={19} />{loading ? t('create.publishing') : t(form.type === 'give' ? 'create.publishGive' : 'create.publishTake')}</button></footer> : null}
      </div>
    </div>
  );
}
