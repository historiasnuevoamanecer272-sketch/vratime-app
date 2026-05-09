const listeners = new Set();
let nextId = 1;

export function showToast(message, type = 'info') {
  const toast = {
    id: nextId++,
    message,
    type,
  };

  listeners.forEach((listener) => listener(toast));
  return toast.id;
}

export function subscribeToasts(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
