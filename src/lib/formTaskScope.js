export const formAuthChanged = () => Object.assign(new Error('form_auth_changed'), { code: 'form_auth_changed' });

// A task belongs to one mounted generation and one account. Re-activating a
// StrictMode effect never revives work started by the previous generation.
export function createFormTaskScope(userId) {
  let active = true, generation = 0, controller = new AbortController();
  const previews = new Map();
  const dispose = () => { active = false; generation += 1; controller.abort(); for (const release of previews.values()) release(); previews.clear(); };
  return {
    activate() { dispose(); controller = new AbortController(); active = true; },
    dispose,
    capture() {
      const captured = generation, signal = controller.signal;
      const isCurrent = () => active && captured === generation && !signal.aborted;
      const assertCurrent = () => { if (!isCurrent()) throw formAuthChanged(); };
      const authorize = async (readUser) => {
        assertCurrent();
        const result = await readUser();
        assertCurrent();
        if (result?.error || !userId || result?.data?.user?.id !== userId) throw formAuthChanged();
      };
      return { isCurrent, assertCurrent, signal, authorize,
        ownPreview(url, release) { assertCurrent(); previews.set(url, () => release(url)); },
        async mutate(mutation, readUser) {
          if (readUser) await authorize(readUser);
          assertCurrent();
          const result = await mutation();
          assertCurrent();
          return result;
        },
      };
    },
  };
}

export async function prepareScopedPreview(file, { task, prepare, isCurrent = () => true, createObjectURL = (blob) => URL.createObjectURL(blob), revokeObjectURL = (url) => URL.revokeObjectURL(url) }) {
  if (!task.isCurrent() || !isCurrent()) return null;
  try {
    const preparedFile = await prepare(file, task.signal);
    if (!task.isCurrent() || !isCurrent()) return null;
    const preview = createObjectURL(preparedFile);
    task.ownPreview(preview, revokeObjectURL);
    return { preparedFile, preview };
  } catch (failure) {
    if (!task.isCurrent() || !isCurrent()) return null;
    throw failure;
  }
}
