export function hasVerifiedLocation({ address, verified, position }) {
  return Boolean(
    verified
    && String(address || '').trim().length >= 3
    && Array.isArray(position)
    && position.length === 2
    && Number.isFinite(Number(position[0]))
    && Number.isFinite(Number(position[1])),
  );
}
