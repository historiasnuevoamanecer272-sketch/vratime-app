import { useRef } from 'react';
import { useAppOverlay } from '../hooks/useAppNavigation';
import { useDialogFocus } from '../hooks/useDialogFocus';

export default function CreationLayer({ onClose, children }) {
  const dialogRef = useRef(null);
  useAppOverlay(true, onClose, 'create');
  useDialogFocus({ open: true, onClose, dialogRef });
  return <div ref={dialogRef} tabIndex={-1} className="creation-layer">{children}</div>;
}
