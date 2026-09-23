const VOTE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export const pointStatus = (votes = [], now = new Date()) => {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) {
    throw new TypeError('A valid current date is required.');
  }

  const currentVotes = votes.filter((vote) => {
    const createdAtMs = new Date(vote?.created_at).getTime();
    const ageMs = nowMs - createdAtMs;
    return Number.isFinite(createdAtMs) && ageMs >= 0 && ageMs <= VOTE_TTL_MS;
  });

  const existsVotes = currentVotes.filter((vote) => vote.value === 'exists').length;
  const missingVotes = currentVotes.filter((vote) => vote.value === 'missing').length;

  if (missingVotes >= 2) return 'unverified';
  return existsVotes >= 3 ? 'verified' : 'unverified';
};
