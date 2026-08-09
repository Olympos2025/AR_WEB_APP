/**
 * Adds intermediate vertices to long segments so lines and polygon outlines
 * can follow the terrain when draped on a DEM. Without this, a 500 m segment
 * would be a straight chord cutting through (or floating above) the slope.
 */

const EARTH_RADIUS = 6371000;
const MAX_TOTAL_POSITIONS = 4000; // safety cap per ring/line

export function densifyPositions(coordinates: number[][], maxSegmentMeters = 25): number[][] {
  if (coordinates.length < 2) return coordinates;
  const result: number[][] = [coordinates[0]];
  for (let i = 1; i < coordinates.length; i++) {
    const prev = coordinates[i - 1];
    const next = coordinates[i];
    const distance = approxDistanceMeters(prev, next);
    const pieces = Math.min(Math.ceil(distance / maxSegmentMeters), 200);
    for (let s = 1; s < pieces; s++) {
      if (result.length >= MAX_TOTAL_POSITIONS) break;
      const f = s / pieces;
      const point: number[] = [
        prev[0] + (next[0] - prev[0]) * f,
        prev[1] + (next[1] - prev[1]) * f,
      ];
      if (prev.length > 2 && next.length > 2) {
        point.push((prev[2] as number) + ((next[2] as number) - (prev[2] as number)) * f);
      }
      result.push(point);
    }
    result.push(next);
  }
  return result;
}

/** Densify every LineString / Polygon ring of a geometry. */
export function densifyGeometry(
  geometry: GeoJSON.Geometry,
  maxSegmentMeters = 25
): GeoJSON.Geometry {
  switch (geometry.type) {
    case 'LineString':
      return { ...geometry, coordinates: densifyPositions(geometry.coordinates, maxSegmentMeters) };
    case 'MultiLineString':
    case 'Polygon':
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((ring) => densifyPositions(ring, maxSegmentMeters)),
      };
    case 'MultiPolygon':
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((poly) =>
          poly.map((ring) => densifyPositions(ring, maxSegmentMeters))
        ),
      };
    case 'GeometryCollection':
      return {
        ...geometry,
        geometries: geometry.geometries.map((g) => densifyGeometry(g, maxSegmentMeters)),
      };
    default:
      return geometry;
  }
}

function approxDistanceMeters(a: number[], b: number[]): number {
  const latRad = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * (Math.PI / 180) * EARTH_RADIUS * Math.cos(latRad);
  const dy = (b[1] - a[1]) * (Math.PI / 180) * EARTH_RADIUS;
  return Math.hypot(dx, dy);
}
