export function measureVisualViewport(viewport, innerHeight, editableFocused = false) {
  const height = Math.max(1, Math.round(viewport?.height || innerHeight || 1));
  const top = Math.max(0, Math.round(viewport?.offsetTop || 0));
  const missing = Math.max(0, Math.round(innerHeight - height - top));
  const keyboardHeight = editableFocused && (viewport?.scale || 1) <= 1.1 && missing > 120 ? missing : 0;
  return { height, top, keyboardHeight };
}

export function observeVisualViewport(host = window) {
  const root = host.document.documentElement;
  const viewport = host.visualViewport;
  let frame;
  const update = () => {
    const editable = host.document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
    const value = measureVisualViewport(viewport, host.innerHeight, editable);
    root.style.setProperty('--app-viewport-height', `${value.height}px`);
    root.style.setProperty('--app-viewport-top', `${value.top}px`);
    root.style.setProperty('--app-keyboard-height', `${value.keyboardHeight}px`);
    root.dataset.keyboardOpen = value.keyboardHeight > 0 ? 'true' : 'false';
  };
  const schedule = () => { host.cancelAnimationFrame(frame); frame = host.requestAnimationFrame(update); };
  update();
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  host.addEventListener('resize', schedule);
  host.document.addEventListener('focusin', schedule);
  host.document.addEventListener('focusout', schedule);
  return () => {
    host.cancelAnimationFrame(frame);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    host.removeEventListener('resize', schedule);
    host.document.removeEventListener('focusin', schedule);
    host.document.removeEventListener('focusout', schedule);
    for (const name of ['--app-viewport-height', '--app-viewport-top', '--app-keyboard-height']) root.style.removeProperty(name);
    delete root.dataset.keyboardOpen;
  };
}
