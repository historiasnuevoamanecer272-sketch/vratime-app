export const DRAFT_TTL = 7 * 24 * 60 * 60 * 1000;
const PREFIX = 'vratime:listing-draft:v1:';
const fields = ['type', 'quantity', 'description', 'condition', 'pickup_mode', 'pickup_time', 'weight_kg', 'loan_duration_days'];
const text = (value, length) => String(value ?? '').slice(0, length);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitize(data) {
  const form = Object.fromEntries(fields.map((key) => [key, text(data?.form?.[key], key === 'description' ? 500 : key === 'pickup_time' ? 300 : 40)]));
  const selected = data?.selected?.id ? Object.fromEntries(['id', 'category_path', 'name_ru', 'name_me', 'name_en', 'name_fr', 'name_de', 'name', 'slug'].filter((key) => data.selected[key] != null).map((key) => [key, text(data.selected[key], 200)])) : null;
  const position = Array.isArray(data?.position) && data.position.length === 2 && data.position.every((value) => Number.isFinite(Number(value))) ? data.position.map(Number) : [42.441, 19.263];
  const existingPhotoUrls = Array.isArray(data?.existingPhotoUrls) ? data.existingPhotoUrls.slice(0, 5).map((url) => text(url, 2000)).filter((url) => /^https?:\/\//.test(url)) : undefined;
  return { form, selected, position, address: text(data?.address, 500), addressVerified: Boolean(data?.addressVerified), locationKind: ['pin', 'address'].includes(data?.locationKind) ? data.locationKind : null, step: [1, 2, 3].includes(data?.step) ? data.step : 1, existingPhotoUrls, publicationId: uuid.test(data?.publicationId || '') ? data.publicationId : undefined };
}

function browserStorage() { try { return globalThis.localStorage; } catch { return null; } }

function browserPhotoStorage() {
  const database = () => new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('unavailable'));
    const request = globalThis.indexedDB.open('vratime-listing-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('blocked'));
    request.onsuccess = () => resolve(request.result);
  });
  const run = async (action, key, value) => {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('photos', action === 'get' ? 'readonly' : 'readwrite');
        const store = transaction.objectStore('photos');
        const request = action === 'get' ? store.get(key) : action === 'set' ? store.put(value, key) : store.delete(key);
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { db.close(); }
  };
  return { get: (key) => run('get', key), set: (key, value) => run('set', key, value), remove: (key) => run('remove', key) };
}

export function createListingDraftStore({ storage = browserStorage(), photoStorage = browserPhotoStorage(), now = Date.now } = {}) {
  const keyFor = (userId, editingId) => userId ? `${PREFIX}${encodeURIComponent(userId)}:${editingId ? `edit:${encodeURIComponent(editingId)}` : 'create'}` : null;
  let queue = Promise.resolve();
  const discard = async (userId, editingId) => {
    const key = keyFor(userId, editingId);
    if (!key) return;
    try { storage?.removeItem(key); } catch { /* Storage can be disabled. */ }
    queue = queue.catch(() => {}).then(() => photoStorage.remove(key).catch(() => {}));
    await queue;
  };
  return {
    async save(userId, editingId, data, photos = []) {
      const key = keyFor(userId, editingId);
      if (!key || !storage) return { text: false, photos: false };
      const savedAt = now();
      const revision = crypto.randomUUID();
      try { storage.setItem(key, JSON.stringify({ savedAt, revision, data: sanitize(data) })); } catch { return { text: false, photos: false }; }
      const safePhotos = photos.slice(0, 5).filter((photo) => photo.file || photo.existing).map((photo) => photo.existing ? { existing: true, preview: text(photo.preview, 2000) } : { file: photo.file, operationId: text(photo.operationId, 100) });
      let photosSaved = true;
      queue = queue.catch(() => {}).then(() => photoStorage.set(key, { savedAt, revision, photos: safePhotos })).catch(() => { photosSaved = false; });
      await queue;
      return { text: true, photos: photosSaved };
    },
    async load(userId, editingId) {
      const key = keyFor(userId, editingId);
      if (!key) return null;
      let stored;
      try { stored = JSON.parse(storage?.getItem(key) || 'null'); } catch { return null; }
      if (!stored?.data || !Number.isFinite(stored.savedAt)) return null;
      if (now() - stored.savedAt >= DRAFT_TTL) { await discard(userId, editingId); return null; }
      let photos = [], photosAvailable = true;
      try { const media = await photoStorage.get(key); if (media?.revision && media.revision === stored.revision) photos = media.photos || []; else photosAvailable = false; } catch { photosAvailable = false; }
      return { data: sanitize(stored.data), photos: photos.slice(0, 5), photosAvailable };
    },
    discard,
  };
}
