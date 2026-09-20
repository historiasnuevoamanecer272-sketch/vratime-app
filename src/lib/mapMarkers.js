import L from 'leaflet';

const markerSvg = (type) => type === 'give'
  ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M7.5 8A2.5 2.5 0 1 1 12 6a2.5 2.5 0 1 1 4.5 2"/></svg>'
  : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';

const marker = (type) => L.divIcon({
  className: 'vratime-marker-wrap',
  html: `<span class="vratime-marker vratime-marker-${type}">${markerSvg(type)}</span>`,
  iconSize: [48, 56],
  iconAnchor: [24, 53],
  popupAnchor: [0, -48],
  tooltipAnchor: [0, -46],
});

export const mapMarkerIcons = {
  give: marker('give'),
  take: marker('take'),
};
