import { useLayoutEffect, useRef, useState } from 'react';

// Let the native editor retain its selection and prediction/composition buffer.
// React state still receives input immediately for validation, drafts and submit.
export default function NativeTextarea({ value = '', onChange, onBlur, ...props }) {
  const field = useRef(null);
  const lastInput = useRef(value);
  const [initialValue] = useState(value);
  useLayoutEffect(() => {
    if (value !== lastInput.current && field.current) {
      field.current.value = value;
      lastInput.current = value;
    }
  }, [value]);
  const commit = (event) => {
    const next = (event.currentTarget || event.target).value;
    if (next === lastInput.current) return;
    lastInput.current = next;
    onChange?.(event);
  };
  return <textarea {...props} ref={field} defaultValue={initialValue} autoCorrect="on" autoCapitalize="sentences" spellCheck onInput={commit} onChange={commit} onCompositionEnd={commit} onBlur={(event) => { commit(event); onBlur?.(event); }} />;
}
