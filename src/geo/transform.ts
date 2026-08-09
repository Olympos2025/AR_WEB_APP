import { LatLon, haversineDistance } from './geoUtils';
import { mapGeometryPositions } from './loaders';

/**
 * In-place-style corrections of real feature coordinates: translate geometry
 * by meters (east/north) and find the vertex nearest to the user so a feature
 * or layer can be snapped onto the user's actual position.
 */

const R = 6371000;

/** What a manual correction applies to: one layer or all visible ones, whole or nearest feature. */
export interface CorrectionTarget {
  layerId: string | 'all';
  nearestFeatureOnly: boolean;
}

export function translateGeometry(
  geometry: GeoJSON.Geometry,
  dEast: number,
  dNorth: number
): GeoJSON.Geometry {
  return mapGeometryPositions(geometry, (position) => {
    const [lon, lat, ...rest] = position;
    const dLat = (dNorth / R) * (180 / Math.PI);
    const dLon = (dEast / (R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
    return [lon + dLon, lat + dLat, ...rest];
  });
}

/** Translate a whole collection, or a single feature of it, by meters. */
export function translateCollection(
  collection: GeoJSON.FeatureCollection,
  dEast: number,
  dNorth: number,
  featureIndex: number | null = null
): GeoJSON.FeatureCollection {
  return {
    ...collection,
    features: collection.features.map((feature, index) => {
      if (!feature.geometry) return feature;
      if (featureIndex !== null && index !== featureIndex) return feature;
      return { ...feature, geometry: translateGeometry(feature.geometry, dEast, dNorth) };
    }),
  };
}

export interface NearestVertexHit {
  layerId: string;
  featureIndex: number;
  featureName: string;
  vertex: LatLon;
  distance: number;
}

/** Find the geometry vertex closest to `from` across the given layers. */
export function findNearestVertex(
  layers: Array<{ id: string; collection: GeoJSON.FeatureCollection }>,
  from: LatLon
): NearestVertexHit | null {
  let best: NearestVertexHit | null = null;
  layers.forEach(({ id, collection }) => {
    collection.features.forEach((feature, featureIndex) => {
      if (!feature.geometry) return;
      forEachPosition(feature.geometry, ([lon, lat]) => {
        const distance = haversineDistance(from, { lat, lon });
        if (!best || distance < best.distance) {
          const props = (feature.properties ?? {}) as Record<string, unknown>;
          best = {
            layerId: id,
            featureIndex,
            featureName: String(props['name'] ?? props['Name'] ?? `#${featureIndex + 1}`),
            vertex: { lat, lon },
            distance,
          };
        }
      });
    });
  });
  return best;
}

/** Meters east/north needed to move `vertex` onto `target`. */
export function deltaToPosition(vertex: LatLon, target: LatLon): { dEast: number; dNorth: number } {
  const dNorth = ((target.lat - vertex.lat) * Math.PI * R) / 180;
  const dEast =
    ((target.lon - vertex.lon) * Math.PI * R * Math.cos((vertex.lat * Math.PI) / 180)) / 180;
  return { dEast, dNorth };
}

export function forEachPosition(geometry: GeoJSON.Geometry, fn: (position: number[]) => void) {
  switch (geometry.type) {
    case 'Point':
      fn(geometry.coordinates);
      break;
    case 'MultiPoint':
    case 'LineString':
      geometry.coordinates.forEach(fn);
      break;
    case 'MultiLineString':
    case 'Polygon':
      geometry.coordinates.forEach((ring) => ring.forEach(fn));
      break;
    case 'MultiPolygon':
      geometry.coordinates.forEach((poly) => poly.forEach((ring) => ring.forEach(fn)));
      break;
    case 'GeometryCollection':
      geometry.geometries.forEach((g) => forEachPosition(g, fn));
      break;
  }
}
