import assert from 'node:assert/strict';
import { popupPanOffset, bindMapPopupReveal } from '../src/lib/popupViewport.js';
const viewport = { left: 0, top: 0, right: 375, bottom: 770 };
assert.deepEqual(popupPanOffset({ left: -120, top: 20, right: 160, bottom: 360 }, viewport), [-132, -54]);
assert.deepEqual(popupPanOffset({ left: 250, top: 100, right: 530, bottom: 440 }, viewport), [167, 0]);
assert.deepEqual(popupPanOffset({ left: 20, top: 100, right: 300, bottom: 440 }, viewport), [0, 0]);
assert.deepEqual(popupPanOffset({ left: 20, top: 500, right: 300, bottom: 840 }, viewport), [0, 162]);
assert.deepEqual(popupPanOffset({ left: 20, top: -200, right: 300, bottom: 900 }, viewport), [0, -274]);
assert.deepEqual(popupPanOffset({ left: -50, top: 100, right: 400, bottom: 440 }, viewport), [37, 0]);
// Leaflet emits popupopen before React has committed its portal contents.
// Measure only in the scheduled frame, after update() has refreshed the layout.
const events = new Map(), frames = new Map(), pans = [];
let frameId = 0, updated = false, open = true;
const map = {
  on: (name, action) => events.set(name, action),
  off: (name) => events.delete(name),
  getContainer: () => ({ getBoundingClientRect: () => viewport }),
  stop() {}, panBy: (...args) => pans.push(args),
};
const popup = {
  isOpen: () => open,
  update: () => { updated = true; },
  getElement: () => ({ querySelector: () => null, getBoundingClientRect: () => {
    assert.equal(updated, true, 'stale popup dimensions measured');
    return { left: -73, top: -47, right: 174, bottom: 342 };
  } }),
};
const unbind = bindMapPopupReveal(map, 'Close', {
  request: action => { frames.set(++frameId, action); return frameId; },
  cancel: id => frames.delete(id),
});
events.get('popupopen')({ popup });
events.get('popupopen')({ popup }); // bubbled opening must not produce a second pan
assert.equal(pans.length, 0);
assert.equal(frames.size, 1);
const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(action => action()); };
flush();
assert.deepEqual(pans, [[[-85, -121], { animate: false }]]);
events.get('popupopen')({ popup });
events.get('popupclose')();
assert.equal(frames.size, 0);
events.get('popupopen')({ popup });
open = false;
flush();
assert.equal(pans.length, 1, 'closed popup moved the map');
events.get('popupopen')({ popup });
unbind();
assert.equal(frames.size, 0);
assert.equal(events.size, 0);
console.log('PASS: popup is revealed once after portal layout; close/unmount cancel pending work');
