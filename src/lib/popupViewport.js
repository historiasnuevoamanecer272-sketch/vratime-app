export function popupPanOffset(popup, viewport) {
  const left = viewport.left + 12, right = viewport.right - 12;
  const top = viewport.top + 74, bottom = viewport.bottom - 92;
  const x = popup.right - popup.left > right - left ? popup.right - right
    : popup.left < left ? popup.left - left : popup.right > right ? popup.right - right : 0;
  // An oversized card keeps its close control at the top; do not oscillate
  // between incompatible top/bottom constraints.
  const y = popup.top < top || popup.bottom - popup.top > bottom - top
    ? popup.top - top : popup.bottom > bottom ? popup.bottom - bottom : 0;
  return [Math.round(x), Math.round(y)];
}

export function revealMapPopup(map, popup, closeLabel) {
  const element = popup?.getElement?.();
  if (!element) return;
  const close = element.querySelector('.leaflet-popup-close-button');
  if (close) { close.setAttribute('aria-label', closeLabel); close.setAttribute('title', closeLabel); }
  const offset = popupPanOffset(element.getBoundingClientRect(), map.getContainer().getBoundingClientRect());
  if (offset.some(Boolean)) { map.stop(); map.panBy(offset, { animate: false }); }
}

export function bindMapPopupReveal(map, closeLabel, frames = {
  request: (action) => requestAnimationFrame(action),
  cancel: (id) => cancelAnimationFrame(id),
}) {
  let pending = null;
  const cancel = () => { if (pending !== null) frames.cancel(pending); pending = null; };
  const opened = ({ popup }) => {
    cancel();
    // React-Leaflet commits the portal after popupopen. Recompute its dimensions
    // in the next frame, then reveal once without continuous map recentering.
    pending = frames.request(() => {
      pending = null;
      if (!popup.isOpen()) return;
      popup.update();
      revealMapPopup(map, popup, closeLabel);
    });
  };
  map.on('popupopen', opened);
  map.on('popupclose', cancel);
  return () => { cancel(); map.off('popupopen', opened); map.off('popupclose', cancel); };
}
