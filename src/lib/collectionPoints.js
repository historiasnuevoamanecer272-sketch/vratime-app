import { validPosition } from './locationValidation.js';

const VOTE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export const normalizeCollectionPoints = (points) => (Array.isArray(points) ? points : [])
  .filter((point) => point && typeof point === 'object'
    && (typeof point.id === 'string' || typeof point.id === 'number')
    && typeof point.name === 'string' && validPosition([point.lat, point.lng]))
  .map((point) => ({
    ...point,
    lat: Number(point.lat),
    lng: Number(point.lng),
    location_label: typeof point.location_label === 'string' ? point.location_label : '',
    description: typeof point.description === 'string' ? point.description : null,
    materials: Array.isArray(point.materials) ? point.materials.filter((key) => typeof key === 'string') : [],
  }));

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
