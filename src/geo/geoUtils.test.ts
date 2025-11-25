import { describe, expect, it } from 'vitest';
import { haversineDistance, toENU } from './geoUtils';

describe('geoUtils', () => {
  it('computes haversine distance', () => {
    const athens = { lat: 37.9838, lon: 23.7275 };
    const larissa = { lat: 39.639, lon: 22.4191 };
    const d = haversineDistance(athens, larissa);
    expect(Math.round(d / 1000)).toBeGreaterThan(180);
    expect(Math.round(d / 1000)).toBeLessThan(250);
  });

  it('converts to ENU', () => {
    const origin = { lat: 0, lon: 0, alt: 0 };
    const point = { lat: 0, lon: 0.001, alt: 10 };
    const enu = toENU(origin, point);
    expect(enu.east).toBeGreaterThan(100); // ~111m
    expect(enu.north).toBeCloseTo(0, 2);
    expect(enu.up).toBe(10);
  });
});
