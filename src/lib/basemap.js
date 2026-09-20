const mapTilerKey = import.meta.env.VITE_MAPTILER_KEY || '';
const mapTilerStyle = import.meta.env.VITE_MAPTILER_STYLE || 'basic-v2';

// A MapTiler key is optional. OpenStreetMap is the privacy-friendly fallback
// used until a project key is provided.
export const baseMap = mapTilerKey
  ? {
      url: `https://api.maptiler.com/maps/${mapTilerStyle}/{z}/{x}/{y}{r}.png?key=${mapTilerKey}`,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a>',
      maxZoom: 20,
    }
  : {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    };
