import { describe, expect, it } from 'vitest';
import { douglasPeucker } from './simplify';

describe('douglasPeucker', () => {
  it('reduces points based on tolerance', () => {
    const line = [
      { east: 0, north: 0 },
      { east: 1, north: 0.1 },
      { east: 2, north: 0 },
    ];
    const simplified = douglasPeucker(line, 0.05);
    expect(simplified.length).toBe(3);
    const simplified2 = douglasPeucker(line, 0.5);
    expect(simplified2.length).toBe(2);
  });
});
