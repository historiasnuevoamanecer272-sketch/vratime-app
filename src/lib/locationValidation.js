const coordinate = (value) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));

export function validPosition(position) {
  return Array.isArray(position) && position.length === 2
    && position.every(coordinate) && Math.abs(Number(position[0])) <= 90 && Math.abs(Number(position[1])) <= 180;
}

export function normalizeMapPosition(position) {
  if (!Array.isArray(position) || position.length !== 2 || !position.every(coordinate) || Math.abs(Number(position[0])) > 90) return null;
  const longitude = Number(position[1]);
  return [Number(position[0]), longitude >= -180 && longitude <= 180 ? longitude : ((longitude + 180) % 360 + 360) % 360 - 180];
}

export function validAddressResults(results) {
  return (Array.isArray(results) ? results : []).filter((result) => result && typeof result.display_name === 'string'
    && result.display_name.trim().length >= 3 && validPosition([result.lat, result.lon])).slice(0, 5);
}

export function hasVerifiedLocation({ address, verified, position }) {
  return Boolean(
    verified
    && String(address || '').trim().length >= 3
    && validPosition(position),
  );
}
