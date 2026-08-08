import { describe, expect, it } from 'vitest';
import { GpsFilter } from './gpsFilter';
import { haversineDistance } from './geoUtils';

const TRUE_POSITION = { lat: 37.98, lon: 23.72 };

/** Deterministic pseudo-random noise so the test is stable. */
function noise(i: number, scale: number): number {
  return Math.sin(i * 12.9898) * scale;
}

function makeSample(i: number, accuracy: number, timestamp: number) {
  const latNoise = (noise(i, accuracy) / 111320) * 0.7;
  const lonNoise = (noise(i + 100, accuracy) / 87000) * 0.7;
  return {
    lat: TRUE_POSITION.lat + latNoise,
    lon: TRUE_POSITION.lon + lonNoise,
    alt: 100,
    accuracy,
    timestamp,
  };
}

describe('GpsFilter', () => {
  it('converges toward the true position as accuracy improves over time', () => {
    const filter = new GpsFilter();
    let t = 0;

    // Cold start: poor fixes 25-30 m off.
    let fix = filter.update({
      lat: TRUE_POSITION.lat + 25 / 111320,
      lon: TRUE_POSITION.lon,
      alt: 100,
      accuracy: 30,
      timestamp: (t += 1000),
    });
    const initialError = haversineDistance(fix, TRUE_POSITION);
    expect(initialError).toBeGreaterThan(15);

    // Accuracy improves: 20 m -> 10 m -> 5 m fixes scattered around the truth.
    for (let i = 0; i < 10; i++) fix = filter.update(makeSample(i, 20, (t += 1000)));
    for (let i = 10; i < 25; i++) fix = filter.update(makeSample(i, 10, (t += 1000)));
    for (let i = 25; i < 45; i++) fix = filter.update(makeSample(i, 5, (t += 1000)));

    const finalError = haversineDistance(fix, TRUE_POSITION);
    expect(finalError).toBeLessThan(initialError / 3);
    expect(finalError).toBeLessThan(5);
    expect(fix.estimatedAccuracy).toBeLessThan(5);
  });

  it('discounts implausible jumps instead of following them', () => {
    const filter = new GpsFilter();
    let t = 0;
    let fix = filter.update({ ...TRUE_POSITION, alt: 0, accuracy: 5, timestamp: (t += 1000) });
    for (let i = 0; i < 5; i++) fix = filter.update(makeSample(i, 5, (t += 1000)));

    // A single wild 500 m jump with claimed good accuracy.
    fix = filter.update({
      lat: TRUE_POSITION.lat + 500 / 111320,
      lon: TRUE_POSITION.lon,
      alt: 0,
      accuracy: 5,
      timestamp: (t += 1000),
    });
    expect(haversineDistance(fix, TRUE_POSITION)).toBeLessThan(30);
  });

  it('still follows sustained movement (walking)', () => {
    const filter = new GpsFilter();
    let t = 0;
    filter.update({ ...TRUE_POSITION, alt: 0, accuracy: 5, timestamp: (t += 1000) });
    // Walk north ~1.4 m/s for 60 s with good fixes.
    let lat = TRUE_POSITION.lat;
    let fix = filter.current!;
    for (let i = 0; i < 60; i++) {
      lat += 1.4 / 111320;
      fix = filter.update({ lat, lon: TRUE_POSITION.lon, alt: 0, accuracy: 5, timestamp: (t += 1000) });
    }
    const lag = haversineDistance(fix, { lat, lon: TRUE_POSITION.lon });
    expect(lag).toBeLessThan(10);
  });
});
