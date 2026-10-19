const stacks = new WeakMap();
const focusable = 'button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]';
const visible = (node) => node && node.isConnected && !node.disabled && !node.hidden && !node.closest?.('[hidden], [inert], [aria-hidden="true"]') && (!node.getClientRects || node.getClientRects().length > 0);

export function installDialogFocus(dialog, onClose, options = {}) {
  const doc = options.document || dialog.ownerDocument;
  const previous = doc.activeElement;
  const stack = stacks.get(doc) || [];
  stacks.set(doc, stack);
  const layer = { dialog };
  stack.push(layer);
  const isTop = () => stack.at(-1) === layer;
  const items = () => [...dialog.querySelectorAll(focusable)].filter((node) => visible(node) && node.tabIndex >= 0);
  const focusFirst = () => (items()[0] || dialog).focus({ preventScroll: true });
  const initial = options.initialFocus;
  if (visible(initial) && dialog.contains(initial)) initial.focus({ preventScroll: true });
  else focusFirst();
  const keydown = (event) => {
    if (!isTop()) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); onClose();
    } else if (event.key === 'Tab') {
      const nodes = items();
      const index = nodes.indexOf(doc.activeElement);
      if (!nodes.length || index < 0 || (event.shiftKey ? index === 0 : index === nodes.length - 1)) {
        event.preventDefault();
        (event.shiftKey ? nodes.at(-1) || dialog : nodes[0] || dialog).focus({ preventScroll: true });
      }
    }
  };
  const focusin = (event) => { if (isTop() && !dialog.contains(event.target)) focusFirst(); };
  doc.addEventListener('keydown', keydown);
  doc.addEventListener('focusin', focusin);
  return () => {
    const wasTop = isTop();
    const index = stack.indexOf(layer);
    if (index >= 0) stack.splice(index, 1);
    doc.removeEventListener('keydown', keydown);
    doc.removeEventListener('focusin', focusin);
    if (wasTop && visible(previous)) previous.focus({ preventScroll: true });
  };
}
