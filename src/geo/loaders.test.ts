import { describe, expect, it } from 'vitest';
import { extensionOf, normalize, parseGeoJson } from './loaders';

describe('parseGeoJson', () => {
  it('keeps WGS84 coordinates untouched', () => {
    const input = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [23.72, 37.98] },
          properties: { name: 'Athens' },
        },
      ],
    };
    const result = parseGeoJson(JSON.stringify(input));
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry).toEqual({ type: 'Point', coordinates: [23.72, 37.98] });
  });

  it('wraps a bare geometry into a FeatureCollection', () => {
    const result = parseGeoJson(JSON.stringify({ type: 'Point', coordinates: [23, 38] }));
    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(1);
  });

  it('reprojects Greek Grid (EPSG:2100) coordinates via heuristic', () => {
    const input = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [500000, 4200000] },
          properties: {},
        },
      ],
    };
    const result = parseGeoJson(JSON.stringify(input));
    const [lon, lat] = (result.features[0].geometry as GeoJSON.Point).coordinates;
    // x_0 = 500000 sits on the central meridian (24°E).
    expect(lon).toBeGreaterThan(23.9);
    expect(lon).toBeLessThan(24.1);
    expect(lat).toBeGreaterThan(37.4);
    expect(lat).toBeLessThan(38.2);
  });

  it('honors a declared legacy crs member', () => {
    const input = {
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::2100' } },
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[480000, 4200000], [500000, 4210000]] },
          properties: {},
        },
      ],
    };
    const result = parseGeoJson(JSON.stringify(input));
    const coords = (result.features[0].geometry as GeoJSON.LineString).coordinates;
    coords.forEach(([lon, lat]) => {
      expect(Math.abs(lon)).toBeLessThanOrEqual(180);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
    });
  });

  it('rejects projected coordinates it cannot identify', () => {
    const input = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [15000000, 22000000] },
          properties: {},
        },
      ],
    };
    expect(() => parseGeoJson(JSON.stringify(input))).toThrow('UNKNOWN_CRS');
  });
});

describe('normalize', () => {
  it('explodes GeometryCollections into plain features', () => {
    const result = normalize({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'GeometryCollection',
            geometries: [
              { type: 'Point', coordinates: [23, 38] },
              { type: 'LineString', coordinates: [[23, 38], [24, 39]] },
            ],
          },
          properties: { name: 'combo' },
        },
        { type: 'Feature', geometry: null as unknown as GeoJSON.Geometry, properties: {} },
      ],
    });
    expect(result.features).toHaveLength(2);
    expect(result.features.map((f) => f.geometry.type)).toEqual(['Point', 'LineString']);
    expect(result.features[0].properties?.name).toBe('combo');
  });
});

describe('extensionOf', () => {
  it('extracts lowercase extensions', () => {
    expect(extensionOf('Parcels.SHP')).toBe('shp');
    expect(extensionOf('data.geojson')).toBe('geojson');
    expect(extensionOf('noext')).toBe('');
  });
});
