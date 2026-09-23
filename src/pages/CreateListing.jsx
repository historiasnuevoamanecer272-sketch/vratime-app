import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { supabase } from '../supabaseClient';
import { baseMap } from '../lib/basemap';
import { categoryLabel } from '../lib/categories';
import { getAppLanguage } from '../i18n';
import { showToast } from '../lib/toast';
import Icon from '../components/Icon';
import CategoryIcon from '../components/CategoryIcon';
import { getCategoryArtwork } from '../lib/categoryArtwork';
import { mapMarkerIcons } from '../lib/mapMarkers';
import { updateMyListing } from '../lib/api';
import { hasVerifiedLocation } from '../lib/locationValidation';

const bucket = 'LISTING-PHOTOS';
const pickupWindowValue = (value) => (typeof value === 'string' ? value : value?.label || '');
const normalizePickupWindows = (value) => (Array.isArray(value) ? value.map(pickupWindowValue).filter(Boolean).slice(0, 3) : []);
function LocationPicker({ position, type, onChange }) {
  useMapEvents({ click: ({ latlng }) => onChange([latlng.lat, latlng.lng]) });
  return <Marker position={position} icon={mapMarkerIcons[type === 'take' ? 'take' : 'give']} draggable eventHandlers={{ dragend: (event) => { const point = event.target.getLatLng(); onChange([point.lat, point.lng]); } }} />;
}

function MapMover({ position }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(position, 14, { duration: 0.7 });
  }, [map, position]);
  return null;
}

export default function CreateListing({ userId, onBack, onSuccess, editingListing = null }) {
  const { t } = useTranslation();
  const language = getAppLanguage();
  const isEditing = Boolean(editingListing?.id);
  const [step, setStep] = useState(isEditing ? 3 : 1);
  const [loading, setLoading] = useState(false);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [trail, setTrail] = useState([]);
  const [selected, setSelected] = useState(editingListing ? { id: editingListing.category_id, category_path: editingListing.category_path, name_ru: editingListing.category } : null);
  const [position, setPosition] = useState(editingListing ? [Number(editingListing.lat), Number(editingListing.lng)] : [42.441, 19.263]);
  const [photos, setPhotos] = useState(() => [...new Set([...(editingListing?.image_urls || []), editingListing?.image_url].filter(Boolean))].map((url) => ({ preview: url, existing: true })));
  const previewUrls = useRef(new Set());
  const reverseRequestRef = useRef(0);
  const [form, setForm] = useState({
    type: editingListing?.type || 'give',
    quantity: Number(editingListing?.quantity || 1),
    description: editingListing?.description || '',
    condition: editingListing?.condition || 'usable',
    pickup_mode: editingListing?.pickup_mode || 'public_place',
    pickup_windows: normalizePickupWindows(editingListing?.pickup_windows),
    weight_kg: editingListing?.weight_kg || '',
    loan_duration_days: editingListing?.loan_duration_days || 7,
  });
  const [address, setAddress] = useState(editingListing?.location_label || '');
  const [addressVerified, setAddressVerified] = useState(Boolean(editingListing?.location_label && Number.isFinite(Number(editingListing?.lat)) && Number.isFinite(Number(editingListing?.lng))));
  const [addressResults, setAddressResults] = useState([]);
  const [addressLoading, setAddressLoading] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.from('categories').select('*').order('id').then(({ data, error }) => {
      if (!active) return;
      setCategories(data || []); setCategoriesLoading(false);
      if (error) showToast(`${t('errors.load')} ${error.message}`, 'error');
    });
    return () => { active = false; };
  }, [t]);

  useEffect(() => () => {
    previewUrls.current.forEach((preview) => URL.revokeObjectURL(preview));
    previewUrls.current.clear();
  }, []);

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

  const selectPhotos = (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) return showToast(t('create.badFile'), 'error');
    if (files.some((file) => file.size > 5 * 1024 * 1024)) return showToast(t('create.tooLarge'), 'error');
    setPhotos((current) => [...current, ...files.map((file) => {
      const preview = URL.createObjectURL(file);
      previewUrls.current.add(preview);
      return { file, preview };
    })]);
  };

  const removePhoto = (preview) => {
    if (previewUrls.current.has(preview)) URL.revokeObjectURL(preview);
    previewUrls.current.delete(preview);
    setPhotos((current) => current.filter((photo) => photo.preview !== preview));
  };

  const reverseGeocode = async (point) => {
    const requestId = ++reverseRequestRef.current;
    setAddressLoading(true);
    setAddressVerified(false);
    try {
      const locale = language === 'me' ? 'sr' : language;
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=${encodeURIComponent(locale)}&lat=${encodeURIComponent(point[0])}&lon=${encodeURIComponent(point[1])}`);
      if (!response.ok) throw new Error(String(response.status));
      const result = await response.json();
      if (requestId !== reverseRequestRef.current) return;
      const label = String(result?.display_name || '').trim();
      if (!label) throw new Error('missing address');
      setAddress(label);
      setAddressResults([]);
      setAddressVerified(true);
    } catch {
      if (requestId === reverseRequestRef.current) showToast(t('workflow.reverseAddressError'), 'error');
    } finally {
      if (requestId === reverseRequestRef.current) setAddressLoading(false);
    }
  };

  const selectPosition = (point) => {
    setPosition(point);
    reverseGeocode(point);
  };

  const useLocation = () => {
    if (!navigator.geolocation) return showToast(t('map.locationMissing'), 'error');
    setAddressLoading(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => selectPosition([coords.latitude, coords.longitude]), () => { setAddressLoading(false); showToast(t('map.locationDenied'), 'error'); }, { enableHighAccuracy: true, timeout: 10000 });
  };

  const searchAddress = async () => {
    if (address.trim().length < 3) return showToast(t('create.addressShort'), 'error');
    setAddressLoading(true);
    try {
      const locale = language === 'me' ? 'sr' : language;
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=me&accept-language=${encodeURIComponent(locale)}&q=${encodeURIComponent(address.trim())}`);
      if (!response.ok) throw new Error(String(response.status));
      const results = await response.json();
      setAddressResults(Array.isArray(results) ? results : []);
      if (!results.length) showToast(t('create.addressNotFound'), 'error');
    } catch {
      showToast(t('create.addressError'), 'error');
    } finally {
      setAddressLoading(false);
    }
  };

  const chooseAddress = (event, result) => {
    event.preventDefault();
    event.stopPropagation();
    setPosition([Number(result.lat), Number(result.lon)]);
    setAddress(result.display_name || address);
    setAddressResults([]);
    setAddressVerified(true);
  };

  const publish = async () => {
    if (!selected || form.quantity < 1 || form.quantity > 10000) return;
    if (form.type === 'lend' && photos.length === 0) return showToast(t('lending.photoRequired', 'Для займа добавьте фотографию состояния вещи.'), 'error');
    if (!hasVerifiedLocation({ address, verified: addressVerified, position })) return showToast(t('workflow.addressRequired'), 'error');
    setLoading(true);
    const uploadedPaths = [];
    try {
      if (!userId) throw new Error('No user');
      const imageUrls = photos.filter((photo) => photo.existing).map((photo) => photo.preview);
      for (const { file } of photos.filter((photo) => photo.file)) {
        const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const uploadedPath = `${userId}/listings/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from(bucket).upload(uploadedPath, file, { contentType: file.type, upsert: false, cacheControl: '3600' });
        if (uploadError) throw uploadError;
        uploadedPaths.push(uploadedPath);
        imageUrls.push(supabase.storage.from(bucket).getPublicUrl(uploadedPath).data.publicUrl);
      }
      const listingPayload = {
        id: editingListing?.id, user_id: userId, type: form.type, status: 'active', category_id: selected.id,
        category: categoryLabel(selected, 'ru'), category_path: selected.category_path,
        description: form.description.trim() || null, image_url: imageUrls[0] || null, image_urls: imageUrls, quantity: Number(form.quantity),
        condition: form.condition, pickup_mode: form.pickup_mode, pickup_windows: form.pickup_windows.filter(Boolean), weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
        loan_duration_days: form.type === 'lend' ? Number(form.loan_duration_days) : null,
        lat: position[0], lng: position[1], location_label: address.trim(), location_verified_at: new Date().toISOString(), moderation_status: 'pending',
      };
      if (isEditing) await updateMyListing(listingPayload);
      else {
        const { error } = await supabase.from('listings').insert(listingPayload);
        if (error) throw error;
      }
      showToast(t(isEditing ? 'workflow.updated' : 'workflow.submittedModeration'), 'success', { prominent: true });
      onSuccess();
      window.setTimeout(() => window.dispatchEvent(new Event('listings-updated')), 0);
    } catch (error) {
      if (uploadedPaths.length) await supabase.storage.from(bucket).remove(uploadedPaths);
      showToast(`${t('errors.save')} ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="wizard-shell" role="dialog" aria-modal="true" aria-label={t(isEditing ? 'workflow.editTitle' : 'create.title')}>
        <header className="wizard-header">
          <button type="button" className="btn-ghost min-h-10 px-3 text-sm" onClick={goBack}><Icon name="arrowLeft" size={17} />{t('common.back')}</button>
          <div className="text-right"><p className="eyebrow text-sea">{t(isEditing ? 'workflow.editTitle' : 'create.title')}</p><p className="mt-1 text-sm font-extrabold text-forest">{t('create.step', { step })}</p></div>
          <div className="wizard-progress col-span-2">{[1, 2, 3].map((value) => <span key={value} className={value <= step ? 'active' : ''} />)}</div>
        </header>

        <main className="wizard-content">
          {step === 1 ? <section>
            <p className="eyebrow text-sea">{t('create.typeEyebrow')}</p><h1 className="font-display mt-2 text-4xl text-forest">{t('create.typeTitle')}</h1>
            <div className="mt-7 space-y-3">
              {[['give', 'gift'], ['take', 'search'], ['lend', 'history']].map(([value, icon]) => <button key={value} type="button" className={`choice-card ${value}`} onClick={() => { setForm((current) => ({ ...current, type: value })); setStep(2); }}><span className="choice-icon"><Icon name={icon} size={29} /></span><span><strong>{t(`create.${value}`, value === 'lend' ? 'Одолжить' : value)}</strong><small>{t(`create.${value}Text`, value === 'lend' ? 'Передать вещь временно и вернуть её в согласованный срок' : '')}</small></span><Icon name="arrowRight" size={20} /></button>)}
            </div>
          </section> : null}

          {step === 2 ? <section>
            <p className="eyebrow text-sea">{t('create.categoryEyebrow')}</p><h1 className="font-display mt-2 text-4xl text-forest">{t('create.categoryTitle')}</h1>
            <div className="scroll-row mt-4 flex gap-2 overflow-x-auto pb-1"><button type="button" className={`chip ${trail.length === 0 ? 'chip-active' : ''}`} onClick={() => setTrail([])}>{t('create.root')}</button>{trail.map((item, index) => <button key={item.id} type="button" className="chip chip-active" onClick={() => setTrail((current) => current.slice(0, index + 1))}>{categoryLabel(item, language)}</button>)}</div>
            {categoriesLoading ? <div className="state-card mt-5">{t('create.loadingCategories')}</div> : visibleCategories.length ? <div className="category-grid mt-5">{visibleCategories.map((item) => {
              const artwork = getCategoryArtwork(item);
              return <button type="button" className={`category-card ${artwork ? 'category-card-illustrated' : ''}`} key={item.id} onClick={() => chooseCategory(item)}><span className="category-icon">{artwork ? <img className="category-card-art" src={artwork} alt="" /> : <CategoryIcon category={item} size={31} />}</span><strong>{categoryLabel(item, language)}</strong><small>{categories.some((child) => child.parent_id === item.id) ? t('create.open') : t('common.choose')}</small></button>;
            })}</div> : <div className="state-card mt-5">{t('create.noCategories')}</div>}
          </section> : null}

          {step === 3 ? <section className="pb-28">
            <p className="eyebrow text-sea">{t('create.publishEyebrow')}</p><h1 className="font-display mt-2 text-4xl text-forest">{t('create.publishTitle')}</h1><p className="mt-3 text-sm leading-6 text-muted">{t('create.publishText')}</p>
            <div className="detail-card mt-5">
              <div className="flex items-center gap-3"><span className="icon-tile"><Icon name="camera" size={22} /></span><div className="min-w-0 flex-1"><strong className="block text-forest">{t('create.photo')}</strong><small className="block truncate text-muted">{photos.length ? t('workflow.photoCount', { count: photos.length }) : t('common.optional')}</small></div><label className="btn-secondary min-h-10 cursor-pointer px-4 text-sm">{t('create.upload')}<input type="file" className="hidden" accept="image/jpeg,image/png,image/webp" multiple onChange={selectPhotos} /></label></div>
              {photos.length ? <div className="photo-preview-grid">{photos.map(({ file, preview }) => <div key={preview} className="photo-preview"><img src={preview} alt={file?.name || ''} /><button type="button" className="btn-link" onClick={() => removePhoto(preview)}>{t('common.remove')}</button></div>)}</div> : null}
            </div>
            <label className="mt-4 block"><span className="field-label">{t('create.quantity')}</span><input className="field" type="number" min="1" max="10000" inputMode="numeric" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: Math.min(10000, Math.max(1, Number(event.target.value) || 1)) }))} /></label>
            <label className="mt-4 block"><span className="field-label">{t('create.description')}</span><textarea className="field min-h-24 resize-y py-3" maxLength={500} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block"><span className="field-label">{t('create.condition', 'Состояние')}</span><select className="field" value={form.condition} onChange={(event) => setForm((current) => ({ ...current, condition: event.target.value }))}><option value="new">{t('create.conditionNew', 'Новое')}</option><option value="usable">{t('create.conditionUsable', 'Можно пользоваться')}</option><option value="worn">{t('create.conditionWorn', 'Есть следы')}</option><option value="repair">{t('create.conditionRepair', 'Нужен ремонт')}</option></select></label>
              <label className="block"><span className="field-label">{t('create.pickupMode', 'Передача')}</span><select className="field" value={form.pickup_mode} onChange={(event) => setForm((current) => ({ ...current, pickup_mode: event.target.value }))}><option value="public_place">{t('create.pickupPublic', 'Публичное место')}</option><option value="entrance">{t('create.pickupEntrance', 'У подъезда')}</option><option value="doorstep">{t('create.pickupDoorstep', 'У двери')}</option><option value="courier">{t('create.pickupCourier', 'Доставка/курьер')}</option></select></label>
            </div>
            <label className="mt-4 block"><span className="field-label">{t('create.weightKg', 'Вес, кг')}</span><input className="field" type="number" min="0" step="0.1" inputMode="decimal" value={form.weight_kg} onChange={(event) => setForm((current) => ({ ...current, weight_kg: event.target.value }))} /></label>
            {form.type === 'lend' ? <label className="mt-4 block"><span className="field-label">{t('lending.durationDays', 'Срок займа, дней')}</span><input className="field" type="number" min="1" max="365" inputMode="numeric" value={form.loan_duration_days} onChange={(event) => setForm((current) => ({ ...current, loan_duration_days: Math.min(365, Math.max(1, Number(event.target.value) || 1)) }))} /><small className="address-hint">{t('lending.conditionPhotoHint', 'Фотография фиксирует состояние вещи до передачи.')}</small></label> : null}
            <div className="mt-4 space-y-2"><span className="field-label">{t('create.pickupWindows', 'Когда удобно забрать')}</span>{[0, 1, 2].map((index) => <input key={index} className="field" value={form.pickup_windows[index] || ''} placeholder={t('create.pickupWindowPlaceholder', 'Например: завтра 18:00-20:00')} onChange={(event) => setForm((current) => { const next = [...current.pickup_windows]; next[index] = event.target.value; return { ...current, pickup_windows: next.filter((item, itemIndex) => item || itemIndex <= index).slice(0, 3) }; })} />)}</div>
            <div className={`address-search mt-4 ${addressVerified ? 'is-verified' : ''}`}><label className="block"><span className="field-label">{t('create.address')}</span><div className="address-search-row"><input className="field" value={address} placeholder={t('create.addressPlaceholder')} onChange={(event) => { setAddress(event.target.value); setAddressResults([]); setAddressVerified(false); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); searchAddress(); } }} /><button type="button" className="btn-secondary min-h-12 px-4" disabled={addressLoading} onClick={searchAddress}><Icon name="search" size={18} /><span className="sr-only">{t('create.findAddress')}</span></button></div></label>{addressResults.length ? <div className="address-results">{addressResults.map((result) => <button type="button" key={`${result.place_id}-${result.lat}`} onClick={(event) => chooseAddress(event, result)}><Icon name="location" size={16} /><span>{result.display_name}</span></button>)}</div> : null}<small className="address-hint">{addressVerified ? t('create.addressVerified') : t('create.addressHint')}</small></div>
            <div className="mt-4 flex justify-end"><button type="button" className="btn-secondary min-h-10 px-4 text-sm" disabled={addressLoading} onClick={useLocation}><Icon name="location" size={16} />{addressLoading ? t('map.locating') : t('create.useLocation')}</button></div>
            <div className="mini-map mt-3"><MapContainer center={position} zoom={13} zoomControl={false} className="h-full w-full"><TileLayer attribution={baseMap.attribution} url={baseMap.url} maxZoom={baseMap.maxZoom} /><MapMover position={position} /><LocationPicker position={position} type={form.type} onChange={selectPosition} /></MapContainer></div>
            <p className="mt-2 text-xs font-semibold text-muted">{t('create.dragMarker')}</p>
          </section> : null}
        </main>

        {step === 3 ? <footer className="wizard-footer"><button type="button" className="btn-primary w-full" disabled={loading || !hasVerifiedLocation({ address, verified: addressVerified, position }) || (form.type === 'lend' && photos.length === 0)} onClick={publish}><Icon name={form.type === 'give' ? 'gift' : form.type === 'lend' ? 'history' : 'handover'} size={19} />{loading ? t('create.publishing') : t(isEditing ? 'workflow.saveChanges' : form.type === 'give' ? 'create.publishGive' : form.type === 'lend' ? 'lending.publish' : 'create.publishTake')}</button></footer> : null}
      </div>
    </div>
  );
}
