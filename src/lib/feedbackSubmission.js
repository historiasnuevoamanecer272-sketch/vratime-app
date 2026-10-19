export async function submitFeedback(payload, { save, deliver }) {
  const feedbackId = await save(payload);
  let delivery = 'queued';
  try {
    const result = await deliver(feedbackId);
    if (['delivered', 'queued', 'unconfigured', 'ambiguous'].includes(result?.delivery)) delivery = result.delivery;
  } catch {
    // The idea already exists. A transport failure must not ask the user to save it again.
  }
  return { feedbackId, delivery };
}
