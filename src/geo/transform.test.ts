import { describe, expect, it } from 'vitest';
import { haversineDistance } from './geoUtils';
import { deltaToPosition, findNearestVertex, translateCollection } from './transform';

const polygonLayer = (): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [23.7, 37.9],
            [23.701, 37.9],
            [23.701, 37.901],
            [23.7, 37.901],
            [23.7, 37.9],
          ],
        ],
      },
      properties: { name: 'parcel' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [23.8, 37.95] },
      properties: { name: 'well' },
    },
  ],
});

describe('translateCollection', () => {
  it('moves every vertex by the requested meters', () => {
    const original = polygonLayer();
    const shifted = translateCollection(original, 10, 20);
    const before = (original.features[0].geometry as GeoJSON.Polygon).coordinates[0][0];
    const after = (shifted.features[0].geometry as GeoJSON.Polygon).coordinates[0][0];
    const moved = haversineDistance(
      { lat: before[1], lon: before[0] },
      { lat: after[1], lon: after[0] }
    );
    expect(moved).toBeCloseTo(Math.hypot(10, 20), 1);
    // Eastward shift increases longitude; northward shift increases latitude.
    expect(after[0]).toBeGreaterThan(before[0]);
    expect(after[1]).toBeGreaterThan(before[1]);
  });

  it('can target a single feature only', () => {
    const original = polygonLayer();
    const shifted = translateCollection(original, 5, 0, 1);
    expect(shifted.features[0].geometry).toEqual(original.features[0].geometry);
    const before = (original.features[1].geometry as GeoJSON.Point).coordinates;
    const after = (shifted.features[1].geometry as GeoJSON.Point).coordinates;
    expect(after[0]).toBeGreaterThan(before[0]);
    expect(after[1]).toBeCloseTo(before[1], 10);
  });
});

describe('findNearestVertex + deltaToPosition', () => {
  it('finds the closest vertex and computes the delta that lands it on the user', () => {
    const me = { lat: 37.90005, lon: 23.70002 };
    const hit = findNearestVertex([{ id: 'L1', collection: polygonLayer() }], me);
    expect(hit).not.toBeNull();
    expect(hit!.layerId).toBe('L1');
    expect(hit!.featureIndex).toBe(0);
    expect(hit!.featureName).toBe('parcel');

    const { dEast, dNorth } = deltaToPosition(hit!.vertex, me);
    const snapped = translateCollection(polygonLayer(), dEast, dNorth, 0);
    const vertexAfter = (snapped.features[0].geometry as GeoJSON.Polygon).coordinates[0][0];
    const residual = haversineDistance({ lat: vertexAfter[1], lon: vertexAfter[0] }, me);
    expect(residual).toBeLessThan(0.05); // < 5 cm
  });
});
