import { describe, expect, it } from 'vitest';
import { OneEuroAngle, normalizeAngle, shortestAngleDiff } from './orientationFilter';

const DT = 1 / 60;

/** Deterministic pseudo-noise in [-1, 1]. */
function noise(i: number): number {
  return Math.sin(i * 12.9898 + 4.1414);
}

describe('shortestAngleDiff', () => {
  it('wraps across 0/360', () => {
    expect(shortestAngleDiff(1, 359)).toBe(2);
    expect(shortestAngleDiff(359, 1)).toBe(-2);
    expect(shortestAngleDiff(180, 0)).toBe(180);
  });
});

describe('OneEuroAngle', () => {
  it('suppresses compass jitter while holding still', () => {
    const filter = new OneEuroAngle(0.04, 0.03, 0.6);
    let min = Infinity;
    let max = -Infinity;
    let out = 0;
    for (let i = 0; i < 600; i++) {
      out = filter.filter(120 + noise(i) * 4, DT); // ±4° jitter around 120°
      if (i > 120) {
        min = Math.min(min, out);
        max = Math.max(max, out);
      }
    }
    // Raw range is 8°; filtered range must be far tighter.
    expect(max - min).toBeLessThan(2);
    expect(Math.abs(out - 120)).toBeLessThan(2.5);
  });

  it('tracks fast turns with little lag', () => {
    const filter = new OneEuroAngle(0.05, 0.03);
    filter.filter(0, DT);
    let raw = 0;
    let out = 0;
    for (let i = 0; i < 120; i++) {
      raw += 90 * DT; // 90 deg/s turn for 2 s
      out = filter.filter(raw, DT);
    }
    expect(Math.abs(shortestAngleDiff(raw, out))).toBeLessThan(12);
  });

  it('does not spin the long way across the 0/360 wrap', () => {
    const filter = new OneEuroAngle(0.05, 0.03);
    for (let i = 0; i < 120; i++) filter.filter(359 + noise(i), DT);
    let out = 0;
    for (let i = 0; i < 240; i++) out = filter.filter(normalizeAngle(2 + noise(i)), DT);
    // Settles near 2°, never unwinding through 180°.
    expect(Math.abs(shortestAngleDiff(2, out))).toBeLessThan(4);
  });
});
