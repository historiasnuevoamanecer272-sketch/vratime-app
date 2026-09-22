export function getDeadlineState(expiresAt, now = new Date()) {
  const difference = Math.max(0, new Date(expiresAt).getTime() - now.getTime());
  const totalSeconds = Math.floor(difference / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  return {
    expired: difference <= 0,
    urgent: difference > 0 && difference <= 2 * 60 * 60 * 1000,
    totalSeconds,
    days,
    hours,
    minutes,
  };
}
