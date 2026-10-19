export function composeFeedback(message, contact = '') {
  const clean = String(contact).replace(/[\r\n\t]/g, ' ').trim();
  if (clean.length > 140) return { message: null, error: 'feedbackExperience.contactTooLong' };
  const combined = String(message).trim() + (clean ? `\n\nКонтакт для ответа / Reply contact: ${clean}` : '');
  if (combined.length > 3000) return { message: null, error: 'feedbackExperience.messageTooLong' };
  return { message: combined, error: null };
}

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
