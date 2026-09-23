const METERS_PER_LATITUDE_DEGREE = 111_320;

const roundCoordinate = (value) => Number(value.toFixed(6));

export const coarseCoordinates = (latitude, longitude, gridMeters = 300) => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const grid = Number(gridMeters);

  if (![lat, lng, grid].every(Number.isFinite) || grid <= 0) {
    throw new TypeError('Valid coordinates and a positive grid size are required.');
  }

  const latitudeStep = grid / METERS_PER_LATITUDE_DEGREE;
  const coarseLatitude = Math.floor(lat / latitudeStep) * latitudeStep;
  const longitudeScale = Math.max(Math.cos((coarseLatitude * Math.PI) / 180), 0.01);
  const longitudeStep = grid / (METERS_PER_LATITUDE_DEGREE * longitudeScale);

  return [
    roundCoordinate(coarseLatitude),
    roundCoordinate(Math.floor(lng / longitudeStep) * longitudeStep),
  ];
};
