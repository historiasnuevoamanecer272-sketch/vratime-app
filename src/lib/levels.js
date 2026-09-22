export const LEVELS = [
  { id: 'start', threshold: 0, icon: 'leaf' },
  { id: 'helper', threshold: 50, icon: 'heart' },
  { id: 'keeper', threshold: 225, icon: 'award' },
  { id: 'ambassador', threshold: 500, icon: 'mountain' },
  { id: 'adriatic', threshold: 950, icon: 'waves' },
];

export function getLevelProgress(points = 0) {
  const safePoints = Math.max(0, Number(points) || 0);
  let currentIndex = LEVELS.findLastIndex((level) => safePoints >= level.threshold);
  if (currentIndex < 0) currentIndex = 0;
  const current = LEVELS[currentIndex];
  const next = LEVELS[currentIndex + 1];
  if (!next) return { currentIndex, nextThreshold: null, remaining: 0, percent: 100 };
  const span = next.threshold - current.threshold;
  const progress = safePoints - current.threshold;
  return {
    currentIndex,
    nextThreshold: next.threshold,
    remaining: Math.max(0, next.threshold - safePoints),
    percent: Math.min(100, Math.max(0, Math.round((progress / span) * 100))),
  };
}
