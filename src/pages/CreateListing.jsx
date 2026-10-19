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
import { listingFormBlockers, pickupTimeForDisplay, pickupTimeForSave, shouldShowCondition } from '../lib/listingForm';
import { prepareImage, imageErrorKey, MAX_LISTING_PHOTOS } from '../lib/imagePreparation';
import { uploadUserMedia } from '../lib/mediaUploads';
import { createListingDraftStore } from '../lib/listingDraft';
import MediaPreview from '../components/MediaPreview';
import { markInstallMilestone } from '../lib/installExperience';
import { createFormTaskScope, prepareScopedPreview } from '../lib/formTaskScope';
import { publishListingOnce } from '../lib/listingPublication';

function LocationPicker({ position, type, onChange }) {
  useMapEvents({ click: ({ latlng }) => onChange([latlng.lat, latlng.lng]) });
  return <Marker position={position} icon={mapMarkerIcons[type === 'take' ? 'take' : 'give']} draggable eventHandlers={{ dragend: (event) => { const point = event.target.getLatLng(); onChange([point.lat, point.lng]); } }} />;
}

function MapMover({ position }) {
  const map = useMap();
  useEffect(() => {
    map.panTo(position, { animate: true, duration: 0.7 });
  }, [map, position]);
  return null;
}

export default function CreateListing({ userId, onBack, onSuccess, onBusyChange, editingListing = null }) {
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
  const locationRequestRef = useRef(0);
  const submitMutex = useRef(false);
  const photoSelectionMutex = useRef(false);
  const uploadedMedia = useRef(new Map());
  const removedPhotoIds = useRef(new Set());
  const taskScope = useMemo(() => createFormTaskScope(userId), [userId]);
  const [publicationId, setPublicationId] = useState(() => crypto.randomUUID());
  const draftStore = useMemo(() => createListingDraftStore(), []);
  const [pendingDraft, setPendingDraft] = useState(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftStatus, setDraftStatus] = useState('');
  const [previewPhoto, setPreviewPhoto] = useState(null);
  const [submitError, setSubmitError] = useState('');
  const [form, setForm] = useState({
    type: editingListing?.type || 'give',
    quantity: editingListing?.quantity == null ? '' : String(editingListing.quantity),
    description: editingListing?.description || '',
    condition: editingListing?.condition || 'usable',
    pickup_mode: editingListing?.pickup_mode || 'public_place',
    pickup_time: pickupTimeForDisplay(editingListing?.pickup_windows),
    weight_kg: editingListing?.weight_kg || '',
    loan_duration_days: editingListing?.loan_duration_days || 7,
  });
  const [address, setAddress] = useState(editingListing?.location_label || '');
  const [addressVerified, setAddressVerified] = useState(Boolean(editingListing?.location_label && Number.isFinite(Number(editingListing?.lat)) && Number.isFinite(Number(editingListing?.lng))));
  const [draftReviewRequired, setDraftReviewRequired] = useState(false);
  const [addressResults, setAddressResults] = useState([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [locationKind, setLocationKind] = useState(addressVerified ? 'address' : null);

  useEffect(() => {
    taskScope.activate();
    const subscription = supabase.auth?.onAuthStateChange?.((_event, session) => { if (session?.user?.id !== userId) taskScope.dispose(); })?.data?.subscription;
    return () => { taskScope.dispose(); subscription?.unsubscribe(); };
  }, [taskScope, userId]);

  useEffect(() => {
    let active = true;
    draftStore.load(userId, editingListing?.id).then((draft) => {
      if (!active) return;
      setPendingDraft(draft);
      setDraftReady(true);
    });
    return () => { active = false; };
  }, [draftStore, userId, editingListing?.id]);

  useEffect(() => {
    if (!draftReady || pendingDraft || !draftDirty || submitMutex.current) return;
    let active = true;
    draftStore.save(userId, editingListing?.id, { form, selected, position, address, addressVerified, locationKind, step, publicationId, existingPhotoUrls: photos.filter((photo) => photo.existing).map((photo) => photo.preview) }, photos).then((result) => {
      if (active) setDraftStatus(!result.text ? 'unavailable' : result.photos ? 'saved' : 'textOnly');
    });
    return () => { active = false; };
  }, [draftStore, draftReady, pendingDraft, draftDirty, userId, editingListing?.id, form, selected, position, address, addressVerified, locationKind, step, photos, publicationId]);

  const restoreDraft = () => {
    const draft = pendingDraft;
    if (!draft) return;
    setForm((current) => ({ ...current, ...draft.data.form }));
    setSelected(draft.data.selected);
    setPosition(draft.data.position);
    setAddress(draft.data.address);
    setAddressVerified(false);
    setDraftReviewRequired(true);
    setLocationKind(draft.data.locationKind);
    setStep(draft.data.step);
    if (draft.data.publicationId) setPublicationId(draft.data.publicationId);
    const existingUrls = draft.data.existingPhotoUrls || [...new Set([...(editingListing?.image_urls || []), editingListing?.image_url].filter(Boolean))];
    const draftPhotos = draft.photosAvailable ? draft.photos : existingUrls.map((preview) => ({ preview, existing: true }));
    const restoredPhotos = draftPhotos.map((photo) => {
      if (photo.existing) return photo;
      return { ...photo, preview: '', operationId: photo.operationId || crypto.randomUUID(), preparing: true };
    });
    setPhotos(restoredPhotos);
    restoredPhotos.filter((photo) => photo.file).forEach((photo) => preparePhoto(photo));
    setDraftStatus(draft.photosAvailable ? 'saved' : 'textOnly');
    setPendingDraft(null);
    setDraftDirty(true);
  };

  const discardDraft = async () => {
    setDraftDirty(false);
    setPendingDraft(null);
    setDraftStatus('discarded');
    await draftStore.discard(userId, editingListing?.id);
  };

  useEffect(() => {
    let active = true;
    supabase.from('categories').select('*').order('id').then(({ data, error }) => {
      if (!active) return;
      setCategories(data || []); setCategoriesLoading(false);
      if (error) showToast(t('errors.load'), 'error');
    });
    return () => { active = false; };
  }, [t]);

  useEffect(() => () => {
    locationRequestRef.current += 1;
    previewUrls.current.forEach((preview) => URL.revokeObjectURL(preview));
    previewUrls.current.clear();
  }, []);

  const parent = trail.at(-1);
  const visibleCategories = useMemo(() => categories.filter((item) => parent ? item.parent_id === parent.id : item.parent_id === null), [categories, parent]);
  const getPath = (items) => items.at(-1)?.category_path || items.map((item) => item.slug).join('/');

  const chooseCategory = (item) => {
    setDraftDirty(true);
    const children = categories.some((category) => category.parent_id === item.id);
    if (children) return setTrail((current) => [...current, item]);
    setSelected({ ...item, category_path: getPath([...trail, item]) });
    setStep(3);
  };

  const goBack = () => {
    if (submitMutex.current) return;
    if (step === 3) return setStep(2);
    if (step === 2 && trail.length) return setTrail((current) => current.slice(0, -1));
    if (step === 2) return setStep(1);
    onBack();
  };

  const preparePhoto = async (photo) => {
    const task = taskScope.capture();
    if (!task.isCurrent() || removedPhotoIds.current.has(photo.operationId)) return;
    setPhotos((current) => current.map((item) => item.operationId === photo.operationId ? { ...item, preparing: true, error: '' } : item));
    try {
      const result = await prepareScopedPreview(photo.file, { task, isCurrent: () => !removedPhotoIds.current.has(photo.operationId), prepare: (file, signal) => prepareImage(file, { kind: 'listing', signal }) });
      if (!result || !task.isCurrent()) return;
      previewUrls.current.add(result.preview);
      setPhotos((current) => current.map((item) => item.operationId === photo.operationId ? { ...item, ...result, preparing: false, error: '' } : item));
    } catch (failure) {
      if (!task.isCurrent() || removedPhotoIds.current.has(photo.operationId)) return;
      setPhotos((current) => current.map((item) => item.operationId === photo.operationId ? { ...item, preparing: false, error: imageErrorKey(failure) } : item));
    }
  };

  const selectPhotos = async (event) => {
    const task = taskScope.capture();
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!task.isCurrent() || !files.length || photoSelectionMutex.current) return;
    const remaining = Math.max(0, MAX_LISTING_PHOTOS - photos.length);
    if (files.length > remaining) showToast(t('mediaExperience.limit'), 'error');
    if (!remaining) return;
    photoSelectionMutex.current = true;
    const entries = files.slice(0, remaining).map((file) => ({ file, preview: '', operationId: crypto.randomUUID(), preparing: true }));
    setDraftDirty(true);
    setPhotos((current) => [...current, ...entries].slice(0, MAX_LISTING_PHOTOS));
    try { for (const entry of entries) { if (!task.isCurrent()) break; await preparePhoto(entry); } }
    finally { photoSelectionMutex.current = false; }
  };

  const removePhoto = (photo) => {
    if (photo.operationId) removedPhotoIds.current.add(photo.operationId);
    setDraftDirty(true);
    if (previewUrls.current.has(photo.preview)) URL.revokeObjectURL(photo.preview);
    previewUrls.current.delete(photo.preview);
    setPhotos((current) => current.filter((item) => photo.operationId ? item.operationId !== photo.operationId : item.preview !== photo.preview));
  };

  const reverseGeocode = async (point, requestId) => {
    try {
      const locale = language === 'me' ? 'sr' : language;
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=${encodeURIComponent(locale)}&lat=${encodeURIComponent(point[0])}&lon=${encodeURIComponent(point[1])}`);
      if (!response.ok) throw new Error(String(response.status));
      const result = await response.json();
      if (requestId !== locationRequestRef.current) return;
      const label = String(result?.display_name || '').trim();
      if (!label) throw new Error('missing address');
      setAddress(label);
      setAddressResults([]);
      setAddressVerified(true);
    } catch {
      // A deliberately chosen pin is usable even without a reverse-geocoded address.
    } finally {
      if (requestId === locationRequestRef.current) setAddressLoading(false);
    }
  };

  const selectPosition = (point) => {
    setDraftDirty(true);
    const requestId = ++locationRequestRef.current;
    setPosition(point);
    setAddress(t('createExperience.pinLabel'));
    setAddressResults([]);
    setAddressVerified(true);
    setLocationKind('pin');
    setAddressLoading(true);
    reverseGeocode(point, requestId);
  };

  const useLocation = () => {
    if (!navigator.geolocation) return showToast(t('map.locationMissing'), 'error');
    const requestId = ++locationRequestRef.current;
    setAddressLoading(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (requestId === locationRequestRef.current) selectPosition([coords.latitude, coords.longitude]);
    }, () => {
      if (requestId !== locationRequestRef.current) return;
      setAddressLoading(false); showToast(t('map.locationDenied'), 'error');
    }, { enableHighAccuracy: true, timeout: 10000 });
  };

  const searchAddress = async () => {
    if (address.trim().length < 3) return showToast(t('create.addressShort'), 'error');
    const requestId = ++locationRequestRef.current;
    setAddressLoading(true);
    try {
      const locale = language === 'me' ? 'sr' : language;
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=me&accept-language=${encodeURIComponent(locale)}&q=${encodeURIComponent(address.trim())}`);
      if (!response.ok) throw new Error(String(response.status));
      const results = await response.json();
      if (requestId !== locationRequestRef.current) return;
      setAddressResults(Array.isArray(results) ? results : []);
      if (!Array.isArray(results) || !results.length) showToast(t('create.addressNotFound'), 'error');
    } catch {
      if (requestId === locationRequestRef.current) showToast(t('create.addressError'), 'error');
    } finally {
      if (requestId === locationRequestRef.current) setAddressLoading(false);
    }
  };

  const chooseAddress = (event, result) => {
    event.preventDefault();
    event.stopPropagation();
    const point = [Number(result.lat), Number(result.lon)];
    if (!hasVerifiedLocation({ address: result.display_name, verified: true, position: point })) return;
    locationRequestRef.current += 1;
    setDraftDirty(true);
    setPosition(point);
    setAddress(result.display_name || address);
    setAddressResults([]);
    setAddressVerified(true);
    setLocationKind('address');
    setAddressLoading(false);
  };

  const blockers = listingFormBlockers({ selected, form, photos, locationConfirmed: hasVerifiedLocation({ address, verified: addressVerified, position }) });
  const showCondition = shouldShowCondition(form.type, selected?.category_path);

  const publish = async () => {
    if (draftReviewRequired) { setSubmitError('draftExperience.reviewRequired'); return; }
    if (submitMutex.current || !draftReady || pendingDraft) return;
    const task = taskScope.capture();
    if (!task.isCurrent()) return;
    const currentBlockers = listingFormBlockers({ selected, form, photos, locationConfirmed: hasVerifiedLocation({ address, verified: addressVerified, position }) && Math.abs(position[0]) <= 90 && Math.abs(position[1]) <= 180 });
    if (currentBlockers.length) return showToast(t(`createExperience.blockers.${currentBlockers[0]}`), 'error');
    if (photos.length > MAX_LISTING_PHOTOS) return showToast(t('mediaExperience.limit'), 'error');
    if (photos.some((photo) => photo.preparing)) return;
    submitMutex.current = true;
    onBusyChange?.(true);
    setSubmitError('');
    setLoading(true);
    try {
      await task.authorize(() => supabase.auth.getUser());
      // Persist identity before INSERT so a lost acknowledgment and a reload
      // cannot turn one attempted publication into two different listings.
      await draftStore.save(userId, editingListing?.id, { form, selected, position, address, addressVerified, locationKind, step, publicationId, existingPhotoUrls: photos.filter((photo) => photo.existing).map((photo) => photo.preview) }, photos);
      task.assertCurrent();
      const imageUrls = photos.filter((photo) => photo.existing).map((photo) => photo.preview);
      for (const photo of photos.filter((item) => item.file)) {
        let uploaded = uploadedMedia.current.get(photo.operationId);
        if (!uploaded) {
          const file = photo.preparedFile || await prepareImage(photo.file, { kind: 'listing', signal: task.signal });
          task.assertCurrent();
          uploaded = await uploadUserMedia({ kind: 'listing', file, operationId: photo.operationId, expectedUserId: userId, signal: task.signal });
          task.assertCurrent();
          uploadedMedia.current.set(photo.operationId, uploaded);
        }
        imageUrls.push(uploaded.url);
      }
      const listingPayload = {
        id: editingListing?.id || publicationId, user_id: userId, type: form.type, status: 'active', category_id: selected.id,
        category: categoryLabel(selected, 'ru'), category_path: selected.category_path,
        description: form.description.trim() || null, image_url: imageUrls[0] || null, image_urls: imageUrls, quantity: Number(form.quantity),
        condition: form.condition, pickup_mode: form.pickup_mode, pickup_windows: pickupTimeForSave(form.pickup_time, editingListing?.pickup_windows), weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
        loan_duration_days: form.type === 'lend' ? Number(form.loan_duration_days) : null,
        lat: position[0], lng: position[1], location_label: address.trim(), location_verified_at: new Date().toISOString(), moderation_status: 'approved',
      };
      if (isEditing) await task.mutate(() => updateMyListing(listingPayload), () => supabase.auth.getUser());
      else {
        await publishListingOnce(listingPayload, {
          task, authorize: () => task.authorize(() => supabase.auth.getUser()),
          insert: (payload) => supabase.from('listings').insert(payload).abortSignal(task.signal),
          readOwn: (id, owner) => supabase.from('listings').select('*').eq('id', id).eq('user_id', owner).abortSignal(task.signal).maybeSingle(),
        });
      }
      task.assertCurrent();
      await draftStore.discard(userId, editingListing?.id);
      task.assertCurrent();
      setDraftDirty(false);
      if (!isEditing) markInstallMilestone('listing');
      showToast(t(isEditing ? 'workflow.updated' : 'createExperience.published'), 'success', { prominent: true });
      onSuccess();
      window.setTimeout(() => window.dispatchEvent(new Event('listings-updated')), 0);
    } catch (failure) {
      if (!task.isCurrent()) return;
      const key = failure?.code === 'form_auth_changed' || failure?.message === 'media_auth_changed' ? 'mediaExperience.errors.authChanged' : failure?.code === 'listing_publication_conflict' ? 'draftExperience.publicationConflict' : failure?.code ? imageErrorKey(failure) : 'draftExperience.saveError';
      setSubmitError(key);
      showToast(t(key), 'error');
    } finally {
      submitMutex.current = false;
      onBusyChange?.(false);
      if (task.isCurrent()) setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="wizard-shell" role="dialog" aria-modal="true" aria-label={t(isEditing ? 'workflow.editTitle' : 'create.title')}>
        <header className="wizard-header">
          <button type="button" className="btn-ghost min-h-10 px-3 text-sm" disabled={loading} onClick={goBack}><Icon name="arrowLeft" size={17} />{t('common.back')}</button>
          <div className="text-right"><p className="eyebrow text-sea">{t(isEditing ? 'workflow.editTitle' : 'create.title')}</p><p className="mt-1 text-sm font-extrabold text-forest">{t('create.step', { step })}</p></div>
          <div className="wizard-progress col-span-2">{[1, 2, 3].map((value) => <span key={value} className={value <= step ? 'active' : ''} />)}</div>
        </header>

        <main className="wizard-content" inert={loading || undefined} aria-busy={loading} onInputCapture={() => setDraftDirty(true)}>
          {pendingDraft ? <aside className="draft-banner" role="status"><strong>{t('draftExperience.title')}</strong><p>{t('draftExperience.text')}</p><div className="draft-banner-actions"><button type="button" className="btn-secondary" onClick={restoreDraft}>{t('draftExperience.restore')}</button><button type="button" className="btn-link" onClick={discardDraft}>{t('draftExperience.discard')}</button></div></aside> : draftStatus ? <div className="draft-status" role="status">{t(`draftExperience.${draftStatus}`)}{draftDirty ? <button type="button" className="btn-link ml-3" onClick={discardDraft}>{t('draftExperience.discard')}</button> : null}</div> : null}
          {step === 1 ? <section>
            <p className="eyebrow text-sea">{t('create.typeEyebrow')}</p><h1 className="font-display mt-2 text-4xl text-forest">{t('create.typeTitle')}</h1>
            <div className="mt-7 space-y-3">
              {[['give', 'gift'], ['take', 'search'], ['lend', 'history']].map(([value, icon]) => <button key={value} type="button" className={`choice-card ${value}`} onClick={() => { setDraftDirty(true); setForm((current) => ({ ...current, type: value })); setStep(2); }}><span className="choice-icon"><Icon name={icon} size={29} /></span><span><strong>{t(`create.${value}`, value === 'lend' ? 'Одолжить' : value)}</strong><small>{t(`create.${value}Text`, value === 'lend' ? 'Передать вещь временно и вернуть её в согласованный срок' : '')}</small></span><Icon name="arrowRight" size={20} /></button>)}
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
            <p className="eyebrow text-sea">{t('create.publishEyebrow')}</p><h1 className="font-display mt-2 text-4xl text-forest">{t('draftExperience.finalTitle')}</h1><p className="mt-3 text-sm leading-6 text-muted">{t('draftExperience.finalText')}</p>
            <p className="create-required-note mt-3 text-sm text-muted">{t('createExperience.requiredNote')}</p>
            <div className="detail-card mt-5">
              <div className="flex items-center gap-3"><span className="icon-tile"><Icon name="camera" size={22} /></span><div className="min-w-0 flex-1"><strong className="block text-forest">{t('create.photo')}{form.type === 'lend' ? ' *' : ` (${t('createExperience.optional')})`}</strong><small className="block text-muted">{t('mediaExperience.count', { count: photos.length })}</small></div><label className="btn-secondary min-h-10 cursor-pointer px-4 text-sm">{t('create.upload')}<input type="file" className="hidden" accept="image/jpeg,image/png,image/webp" multiple disabled={loading || photos.length >= MAX_LISTING_PHOTOS} aria-required={form.type === 'lend'} aria-describedby="listing-photo-hint listing-photo-error" onChange={selectPhotos} /></label></div>
              <small id="listing-photo-hint" className="media-hint">{t('mediaExperience.hint')}</small>
              {blockers.includes('loanPhoto') ? <small id="listing-photo-error" className="field-error">{t('createExperience.blockers.loanPhoto')}</small> : null}
              {photos.length ? <div className="photo-preview-grid">{photos.map((photo) => <div key={photo.operationId || photo.preview} className="photo-preview">{photo.preview ? <button type="button" className="media-photo-open" aria-label={t('mediaExperience.preview')} onClick={() => setPreviewPhoto(photo)}><img src={photo.preview} alt={photo.file?.name || ''} /></button> : <p className="media-photo-state">{photo.file?.name}</p>}{photo.preparing ? <p className="media-photo-state" role="status">{t('mediaExperience.preparing')}</p> : photo.error ? <div className="media-photo-state"><p className="field-error" role="alert">{t(photo.error)}</p><button type="button" className="btn-link" disabled={loading} onClick={() => preparePhoto(photo)}>{t('mediaExperience.retry')}</button></div> : null}<button type="button" className="btn-link" disabled={loading} onClick={() => removePhoto(photo)}>{t('common.remove')}</button></div>)}</div> : null}
            </div>
            <label className="mt-4 block"><span className="field-label">{t('create.quantity')} *</span><input name="quantity" className="field" type="number" min="1" max="10000" step="1" inputMode="numeric" required aria-invalid={blockers.includes('quantity')} aria-describedby="create-quantity-error" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} />{blockers.includes('quantity') ? <small id="create-quantity-error" className="field-error">{t('createExperience.blockers.quantity')}</small> : null}</label>
            <label className="mt-4 block"><span className="field-label">{t('create.description')} <span className="create-optional">({t('createExperience.optional')})</span></span><textarea className="field min-h-24 resize-y py-3" maxLength={500} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
            {showCondition ? <label className="mt-4 block"><span className="field-label">{t('create.condition')}</span><select className="field" value={form.condition} onChange={(event) => setForm((current) => ({ ...current, condition: event.target.value }))}><option value="new">{t('create.conditionNew')}</option><option value="usable">{t('create.conditionUsable')}</option><option value="worn">{t('create.conditionWorn')}</option><option value="repair">{t('create.conditionRepair')}</option></select></label> : null}
            <label className="mt-4 block"><span className="field-label">{t('create.weightKg')} <span className="create-optional">({t('createExperience.optional')})</span></span><input className="field" type="number" min="0" step="0.1" inputMode="decimal" value={form.weight_kg} onChange={(event) => setForm((current) => ({ ...current, weight_kg: event.target.value }))} /></label>
            {form.type === 'lend' ? <label className="mt-4 block"><span className="field-label">{t('lending.durationDays')} *</span><input name="loan_duration_days" className="field" type="number" min="1" max="365" step="1" inputMode="numeric" required aria-invalid={blockers.includes('loanDuration')} aria-describedby="create-loan-error" value={form.loan_duration_days} onChange={(event) => setForm((current) => ({ ...current, loan_duration_days: event.target.value }))} />{blockers.includes('loanDuration') ? <small id="create-loan-error" className="field-error">{t('createExperience.blockers.loanDuration')}</small> : null}<small className="address-hint">{t('lending.conditionPhotoHint')}</small></label> : null}
            <label className="mt-4 block"><span className="field-label">{t('createExperience.pickupTime')} <span className="create-optional">({t('createExperience.optional')})</span></span><input name="pickup_time" className="field" value={form.pickup_time} placeholder={t('createExperience.pickupTimePlaceholder')} onChange={(event) => setForm((current) => ({ ...current, pickup_time: event.target.value }))} /></label>
            <div className={`address-search mt-4 ${addressVerified ? 'is-verified' : ''}`}><label className="block"><span className="field-label">{t('createExperience.address')} *</span><div className="address-search-row"><input name="address" className="field" value={address} aria-required="true" aria-invalid={!addressVerified} aria-describedby="create-location-hint" placeholder={t('create.addressPlaceholder')} onChange={(event) => { locationRequestRef.current += 1; setAddress(event.target.value); setAddressResults([]); setAddressVerified(false); setLocationKind(null); setAddressLoading(false); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); searchAddress(); } }} /><button type="button" className="btn-secondary min-h-12 px-4" disabled={addressLoading} onClick={searchAddress}><Icon name="search" size={18} /><span className="sr-only">{t('create.findAddress')}</span></button></div></label>{addressResults.length ? <div className="address-results">{addressResults.map((result) => <button type="button" key={`${result.place_id}-${result.lat}`} onClick={(event) => chooseAddress(event, result)}><Icon name="location" size={16} /><span>{result.display_name}</span></button>)}</div> : null}<small id="create-location-hint" className="address-hint" aria-live="polite">{addressVerified ? t(locationKind === 'pin' ? addressLoading ? 'createExperience.pinResolving' : 'createExperience.pinConfirmed' : 'createExperience.addressConfirmed') : t(address.trim().length < 3 ? 'createExperience.addressShort' : 'createExperience.addressUnconfirmed')}</small>{addressVerified ? <small className="address-hint create-location-coordinates">{t('createExperience.coordinates', { latitude: position[0].toFixed(5), longitude: position[1].toFixed(5) })}</small> : null}</div>
            <div className="mt-4 flex justify-end"><button type="button" className="btn-secondary min-h-10 px-4 text-sm" disabled={addressLoading} onClick={useLocation}><Icon name="location" size={16} />{addressLoading ? t('map.locating') : t('create.useLocation')}</button></div>
            <div className="mini-map mt-3"><MapContainer center={position} zoom={13} zoomControl={false} className="h-full w-full"><TileLayer attribution={baseMap.attribution} url={baseMap.url} maxZoom={baseMap.maxZoom} /><MapMover position={position} /><LocationPicker position={position} type={form.type} onChange={selectPosition} /></MapContainer></div>
            <p className="mt-2 text-xs font-semibold text-muted">{t('createExperience.mapHint')}</p>
            {draftReviewRequired ? <label className="draft-banner mt-4 flex items-start gap-3"><input type="checkbox" name="draft_review" className="mt-1 h-6 w-6 shrink-0" checked={false} onChange={(event) => { if (event.target.checked) { setDraftReviewRequired(false); setAddressVerified(hasVerifiedLocation({ address, position, verified:true })); setSubmitError(''); } }} /><span>{t('draftExperience.reviewRequired')}</span></label> : null}
          </section> : null}
        </main>

        {step === 3 ? <footer className="wizard-footer"><div id="create-submit-status" className={`create-submit-status ${blockers.length ? 'has-blockers' : 'is-ready'}`} aria-live="polite">{blockers.length ? <><p>{t('createExperience.blockersTitle')}</p><ul>{blockers.map((key) => <li key={key}>{t(`createExperience.blockers.${key}`)}</li>)}</ul></> : <p>{t('createExperience.ready')}</p>}</div>{submitError ? <p className="field-error" role="alert">{t(submitError)}</p> : null}<button type="button" className="btn-primary w-full" aria-describedby="create-submit-status" disabled={loading || draftReviewRequired || !draftReady || Boolean(pendingDraft) || blockers.length > 0 || photos.some((photo) => photo.preparing)} onClick={publish}>{loading ? t('create.publishing') : t(isEditing ? 'workflow.saveChanges' : form.type === 'give' ? 'create.publishGive' : form.type === 'lend' ? 'lending.publish' : 'create.publishTake')}</button></footer> : null}
      </div>
      {previewPhoto ? <MediaPreview src={previewPhoto.preview} alt={previewPhoto.file?.name || ''} onClose={() => setPreviewPhoto(null)} /> : null}
    </div>
  );
}
