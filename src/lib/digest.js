const utcDateKey = (value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

export const isDigestDue = (search = {}, now = new Date()) => {
  const currentDate = utcDateKey(now);
  if (!currentDate) {
    throw new TypeError('A valid current date is required.');
  }

  const lastDigestDate = utcDateKey(search.last_digest_at);
  return !lastDigestDate || lastDigestDate !== currentDate;
};
