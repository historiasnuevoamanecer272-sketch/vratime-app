export const MAX_LISTING_PHOTOS = 5;
const INPUT_LIMIT = 20 * 1024 * 1024;
const settings = { avatar: { edge: 512, bytes: 512 * 1024 }, listing: { edge: 1600, bytes: 2 * 1024 * 1024 }, feedback: { edge: 1600, bytes: 2 * 1024 * 1024 } };
const error = (code) => Object.assign(new Error(code), { code });
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

export function imageErrorKey(failure) {
  if (failure?.code === 'form_auth_changed' || failure?.message === 'media_auth_changed') return 'mediaExperience.errors.authChanged';
  const codes = ['unsupported', 'inputTooLarge', 'decode', 'outputTooLarge', 'unavailable'];
  return `mediaExperience.errors.${codes.includes(failure?.code) ? failure.code : 'upload'}`;
}

// Read dimensions before decoding. A malicious or enormous image must not cause
// an unbounded canvas allocation, including on browsers without bitmap resizing.
export async function imageDimensions(file) {
  const bytes = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
  const view = new DataView(bytes.buffer);
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47) return [view.getUint32(16), view.getUint32(20)];
  if (bytes.length >= 30 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) {
    const uint24 = (offset) => bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
    const chunk = view.getUint32(12);
    if (chunk === 0x56503858) return [uint24(24) + 1, uint24(27) + 1];
    if (chunk === 0x56503820) return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff];
    if (chunk === 0x5650384c) return [1 + (bytes[21] | ((bytes[22] & 63) << 8)), 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 15) << 10))];
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let cursor = 2, orientation = 1;
    while (cursor + 8 < bytes.length) {
      if (bytes[cursor] !== 0xff) break;
      const marker = bytes[cursor + 1];
      if (marker === 0xe1 && view.getUint32(cursor + 4) === 0x45786966) {
        try {
          const tiff = cursor + 10;
          const little = view.getUint16(tiff) === 0x4949;
          const directory = tiff + view.getUint32(tiff + 4, little);
          const entries = view.getUint16(directory, little);
          for (let index = 0; index < Math.min(entries, 256); index += 1) {
            const entry = directory + 2 + index * 12;
            if (view.getUint16(entry, little) === 0x0112) orientation = view.getUint16(entry + 8, little);
          }
        } catch { /* Invalid EXIF is ignored; the decoder still verifies pixels. */ }
      }
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        const width = view.getUint16(cursor + 7), height = view.getUint16(cursor + 5);
        return orientation >= 5 && orientation <= 8 ? [height, width] : [width, height];
      }
      const length = view.getUint16(cursor + 2);
      if (length < 2) break;
      cursor += 2 + length;
    }
  }
  throw error('decode');
}

async function decode(file, edge) {
  const [width, height] = await imageDimensions(file);
  if (!width || !height || width > 16000 || height > 16000 || width * height > 60000000) throw error('decode');
  const ratio = Math.min(1, Math.max(edge, 2048) / Math.max(width, height));
  if (typeof createImageBitmap === 'function') return createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: Math.max(1, Math.round(width * ratio)), resizeHeight: Math.max(1, Math.round(height * ratio)), resizeQuality: 'high' });
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally { URL.revokeObjectURL(url); }
}

const browserEnvironment = {
  decode,
  canvas: (width, height) => Object.assign(document.createElement('canvas'), { width, height }),
  encode: (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(error('decode')), type, quality)),
};

export async function prepareImage(file, { kind = 'listing', crop = {}, environment = browserEnvironment, signal } = {}) {
  signal?.throwIfAborted();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file?.type)) throw error('unsupported');
  if (!file.size || file.size > INPUT_LIMIT) throw error('inputTooLarge');
  const config = settings[kind];
  if (!config) throw error('unavailable');
  let decoded;
  try {
    decoded = await environment.decode(file, config.edge);
    signal?.throwIfAborted();
    const width = decoded.width || decoded.naturalWidth, height = decoded.height || decoded.naturalHeight;
    if (!width || !height) throw error('decode');
    const square = kind === 'avatar';
    const side = Math.min(width, height) / clamp(crop.zoom || 1, 1, 3);
    const source = square ? [(width - side) * clamp(crop.x ?? 0.5, 0, 1), (height - side) * clamp(crop.y ?? 0.5, 0, 1), side, side] : [0, 0, width, height];
    let edge = square ? 512 : Math.min(config.edge, Math.max(width, height));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const targetWidth = square ? 512 : Math.max(1, Math.round(width * edge / Math.max(width, height)));
      const targetHeight = square ? 512 : Math.max(1, Math.round(height * edge / Math.max(width, height)));
      const canvas = environment.canvas(targetWidth, targetHeight);
      try {
        const context = canvas.getContext('2d');
        if (!context) throw error('unavailable');
        context.drawImage(decoded, ...source, 0, 0, targetWidth, targetHeight);
        const blob = await environment.encode(canvas, file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp', 0.88 - attempt * 0.16);
        signal?.throwIfAborted();
        if (blob.size <= config.bytes) {
          const extension = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
          return new File([blob], `photo.${extension}`, { type: blob.type, lastModified: Date.now() });
        }
      } finally { canvas.width = 1; canvas.height = 1; }
      if (!square) edge *= 0.75;
    }
    throw error('outputTooLarge');
  } catch (failure) {
    if (signal?.aborted || failure?.name === 'AbortError') throw failure;
    if (['unsupported', 'inputTooLarge', 'decode', 'outputTooLarge', 'unavailable'].includes(failure?.code)) throw failure;
    throw error('decode');
  } finally { decoded?.close?.(); }
}
