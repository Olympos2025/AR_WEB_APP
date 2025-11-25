export interface LatLon {
  lat: number;
  lon: number;
  alt?: number;
}

const R = 6371000; // meters

export function haversineDistance(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearing(a: LatLon, b: LatLon): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const brng = Math.atan2(y, x);
  return (toDeg(brng) + 360) % 360;
}

export function toENU(origin: LatLon, point: LatLon): { east: number; north: number; up: number } {
  const dLat = toRad(point.lat - origin.lat);
  const dLon = toRad(point.lon - origin.lon);
  const lat0 = toRad(origin.lat);

  const east = dLon * Math.cos(lat0) * R;
  const north = dLat * R;
  const up = (point.alt ?? 0) - (origin.alt ?? 0);
  return { east, north, up };
}

export function smoothPositions(samples: LatLon[], maxSamples = 5): LatLon | null {
  const trimmed = samples.slice(-maxSamples);
  if (!trimmed.length) return null;
  const sum = trimmed.reduce(
    (acc, p) => {
      acc.lat += p.lat;
      acc.lon += p.lon;
      acc.alt += p.alt ?? 0;
      return acc;
    },
    { lat: 0, lon: 0, alt: 0 }
  );
  return { lat: sum.lat / trimmed.length, lon: sum.lon / trimmed.length, alt: sum.alt / trimmed.length };
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}
