function parsePlacemark(placemark, index) {
  const name = placemark.getElementsByTagName('name')[0]?.textContent ?? `Feature ${index + 1}`;
  const coordinatesText = placemark.getElementsByTagName('coordinates')[0]?.textContent ?? '';
  const coordinates = parseCoordinates(coordinatesText);

  if (!coordinates.length) return null;

  if (placemark.getElementsByTagName('Point').length) {
    const [lon, lat, alt] = coordinates[0];
    return buildFeature({ name, geometry: { type: 'Point', coordinates: [lon, lat, alt] } });
  }

  if (placemark.getElementsByTagName('LineString').length) {
    return buildFeature({ name, geometry: { type: 'LineString', coordinates } });
  }

  if (placemark.getElementsByTagName('Polygon').length) {
    return buildFeature({ name, geometry: { type: 'Polygon', coordinates: [coordinates] } });
  }

  return null;
}

function parseCoordinates(input) {
  return input
    .trim()
    .split(/\s+/)
    .map((row) => row.split(',').map((value) => Number(value.trim())))
    .filter((coords) => coords.length >= 2 && coords.every((value) => !Number.isNaN(value)));
}

function buildFeature({ name, geometry }) {
  return {
    type: 'Feature',
    geometry,
    properties: { name },
  };
}

function normalizeFeatureCollection(input) {
  if (typeof input === 'object' && input && 'features' in input) {
    const collection = input;
    const features = Array.isArray(collection.features)
      ? collection.features.filter((f) => Boolean(f && f.geometry))
      : [];
    return { type: 'FeatureCollection', features };
  }

  return { type: 'FeatureCollection', features: [] };
}

export function kml(dom) {
  const placemarks = Array.from(dom.getElementsByTagName('Placemark'));
  const features = placemarks.map((placemark, index) => parsePlacemark(placemark, index)).filter(Boolean);
  return normalizeFeatureCollection({ type: 'FeatureCollection', features });
}

export default { kml };
