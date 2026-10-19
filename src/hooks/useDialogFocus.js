import { useEffect, useLayoutEffect, useRef } from 'react';
import { installDialogFocus } from '../lib/dialogFocus';

export function useDialogFocus({ open, onClose, dialogRef, initialFocusRef }) {
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open || !dialogRef.current) return undefined;
    return installDialogFocus(dialogRef.current, () => closeRef.current(), { initialFocus: initialFocusRef?.current });
  }, [open, dialogRef, initialFocusRef]);
  return { role: 'dialog', 'aria-modal': true, tabIndex: -1 };
}
