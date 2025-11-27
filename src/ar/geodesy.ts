import { LatLon, bearing as computeBearing, haversineDistance } from '../geo/geoUtils';

export type TargetKind = 'point' | 'centroid' | 'vertex';

export interface FeatureTarget {
  id: string;
  label: string;
  point: LatLon;
  distance: number;
  bearing: number;
  kind: TargetKind;
}

export interface TargetContext {
  origin: LatLon;
  collection: GeoJSON.FeatureCollection;
}

export function normalizeBearing(value: number): number {
  const normalized = ((value % 360) + 360) % 360;
  return normalized;
}

export function relativeBearing(targetBearing: number, heading: number): number {
  const delta = normalizeBearing(targetBearing - heading);
  return delta > 180 ? delta - 360 : delta;
}

export function extractTargets({ origin, collection }: TargetContext): FeatureTarget[] {
  const targets: FeatureTarget[] = [];

  collection.features.forEach((feature, index) => {
    if (!feature.geometry) return;
    const label = (feature.properties as Record<string, unknown>)?.name as string | undefined;
    const common = `${feature.geometry.type}-${index}`;

    if (feature.geometry.type === 'Point') {
      const [lon, lat] = (feature.geometry as GeoJSON.Point).coordinates;
      targets.push(buildTarget({ id: common, label, point: { lat, lon }, origin, kind: 'point' }));
      return;
    }

    if (feature.geometry.type === 'LineString') {
      const coords = (feature.geometry as GeoJSON.LineString).coordinates;
      coords.forEach(([lon, lat], idx) =>
        targets.push(
          buildTarget({ id: `${common}-v${idx}`, label, point: { lat, lon }, origin, kind: 'vertex' })
        )
      );
      const centroid = averageCentroid(coords);
      targets.push(buildTarget({ id: `${common}-centroid`, label, point: centroid, origin, kind: 'centroid' }));
      return;
    }

    if (feature.geometry.type === 'Polygon') {
      const outer = (feature.geometry as GeoJSON.Polygon).coordinates[0];
      outer.forEach(([lon, lat], idx) =>
        targets.push(
          buildTarget({ id: `${common}-v${idx}`, label, point: { lat, lon }, origin, kind: 'vertex' })
        )
      );
      const centroid = averageCentroid(outer);
      targets.push(buildTarget({ id: `${common}-centroid`, label, point: centroid, origin, kind: 'centroid' }));
    }
  });

  return targets;
}

function buildTarget({
  id,
  label,
  point,
  origin,
  kind,
}: {
  id: string;
  label?: string;
  point: LatLon;
  origin: LatLon;
  kind: TargetKind;
}): FeatureTarget {
  const distance = haversineDistance(origin, point);
  const bearing = computeBearing(origin, point);
  return {
    id,
    label: label ?? kind,
    point,
    distance,
    bearing,
    kind,
  };
}

function averageCentroid(coords: number[][]): LatLon {
  const { lat, lon } = coords.reduce(
    (acc, [lon, lat]) => {
      acc.lat += lat;
      acc.lon += lon;
      return acc;
    },
    { lat: 0, lon: 0 }
  );
  const total = coords.length || 1;
  return { lat: lat / total, lon: lon / total };
}
