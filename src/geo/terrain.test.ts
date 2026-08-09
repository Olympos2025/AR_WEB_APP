import { describe, expect, it } from 'vitest';
import { densifyPositions } from './densify';
import { decodeTerrarium } from './elevation';
import { haversineDistance } from './geoUtils';

describe('decodeTerrarium', () => {
  it('decodes the terrarium PNG encoding', () => {
    // 0 m -> R=128, G=0, B=0  (128*256 - 32768 = 0)
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    // 831.25 m -> R=131, G=63, B=64: 131*256 + 63 + 64/256 - 32768
    expect(decodeTerrarium(131, 63, 64)).toBeCloseTo(831.25, 5);
    // Below sea level.
    expect(decodeTerrarium(127, 246, 0)).toBeCloseTo(-10, 5);
  });
});

describe('densifyPositions', () => {
  it('splits long segments into ~max-length pieces', () => {
    // ~500 m eastward segment at lat 38.
    const start = [23.7, 38];
    const end = [23.70570, 38];
    const densified = densifyPositions([start, end], 25);
    expect(densified.length).toBeGreaterThan(15);
    expect(densified[0]).toEqual(start);
    expect(densified[densified.length - 1]).toEqual(end);
    for (let i = 1; i < densified.length; i++) {
      const step = haversineDistance(
        { lat: densified[i - 1][1], lon: densified[i - 1][0] },
        { lat: densified[i][1], lon: densified[i][0] }
      );
      expect(step).toBeLessThanOrEqual(26);
    }
  });

  it('keeps short segments untouched and interpolates altitude when present', () => {
    const coords = [
      [23.7, 38, 100],
      [23.70003, 38, 110], // ~2.6 m
    ];
    expect(densifyPositions(coords, 25)).toEqual(coords);

    const long = densifyPositions(
      [
        [23.7, 38, 100],
        [23.7057, 38, 200],
      ],
      100
    );
    const mid = long[Math.floor(long.length / 2)];
    expect(mid[2]).toBeGreaterThan(100);
    expect(mid[2]).toBeLessThan(200);
  });
});
