import assert from 'node:assert/strict';
const subject = await import('../src/lib/imagePreparation.js').catch(() => ({}));
assert.equal(typeof subject.prepareImage, 'function', 'Selected photos must be normalized before uploading');
const { prepareImage, imageErrorKey } = subject;
// A portrait iPhone JPEG stores landscape pixel dimensions plus EXIF rotation.
// Ignoring that tag distorts the normalized portrait and avatar crop.
const exifJpeg = new Uint8Array([255,216,255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0,255,192,0,17,8,7,208,15,160,3,1,17,0,2,17,0,3,17,0]);
assert.deepEqual(await subject.imageDimensions(new File([exifJpeg], 'portrait.jpg', { type: 'image/jpeg' })), [2000, 4000]);
const file = new File([new Uint8Array(100)], 'phone.jpg', { type: 'image/jpeg' });
const draws = [];
let closed = 0;
const environment = {
  decode: async () => ({ width: 4000, height: 2000, close: () => { closed += 1; } }),
  canvas: (width, height) => ({ width, height, getContext: () => ({ drawImage: (...args) => draws.push(args) }) }),
  encode: async (canvas, type) => new Blob([new Uint8Array(canvas.width * 10)], { type }),
};
const prepared = await prepareImage(file, { kind: 'listing', environment });
assert.equal(prepared.type, 'image/jpeg');
assert.ok(prepared.size <= 2 * 1024 * 1024);
assert.deepEqual(draws[0].slice(-4), [0, 0, 1600, 800]);
assert.equal(closed, 1, 'Decoded images must release their memory');
draws.length = 0;
await prepareImage(file, { kind: 'avatar', crop: { zoom: 2, x: 1, y: 0 }, environment });
assert.deepEqual(draws[0].slice(1), [3000, 0, 1000, 1000, 0, 0, 512, 512]);
await assert.rejects(prepareImage(new File(['bad'], 'bad.gif', { type: 'image/gif' }), { kind: 'listing', environment }), { code: 'unsupported' });
await assert.rejects(prepareImage({ type: 'image/jpeg', size: 21 * 1024 * 1024 }, { kind: 'listing', environment }), { code: 'inputTooLarge' });
await assert.rejects(prepareImage(file, { kind: 'listing', environment: { ...environment, decode: async () => { throw new Error('iCloud unavailable'); } } }), { code: 'decode' });
await assert.rejects(prepareImage(file, { kind: 'listing', environment: { ...environment, encode: async () => new Blob([new Uint8Array(3 * 1024 * 1024)], { type: 'image/jpeg' }) } }), { code: 'outputTooLarge' });
assert.equal(imageErrorKey(new Error('database SQL policy')), 'mediaExperience.errors.upload');
assert.equal(imageErrorKey({ code: 'decode' }), 'mediaExperience.errors.decode');
console.log('Image preparation passed: bounded resize/crop, limits, decode failure, memory cleanup, safe error keys.');
