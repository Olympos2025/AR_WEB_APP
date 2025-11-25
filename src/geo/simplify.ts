export interface Vec2 {
  east: number;
  north: number;
}

function perpendicularDistance(point: Vec2, start: Vec2, end: Vec2): number {
  const numerator = Math.abs(
    (end.north - start.north) * point.east -
      (end.east - start.east) * point.north +
      end.east * start.north -
      end.north * start.east
  );
  const denominator = Math.sqrt((end.north - start.north) ** 2 + (end.east - start.east) ** 2);
  return denominator === 0 ? 0 : numerator / denominator;
}

export function douglasPeucker(points: Vec2[], epsilon: number): Vec2[] {
  if (points.length < 3) return points;

  let dmax = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const rec1 = douglasPeucker(points.slice(0, index + 1), epsilon);
    const rec2 = douglasPeucker(points.slice(index), epsilon);
    return rec1.slice(0, -1).concat(rec2);
  }
  return [points[0], points[points.length - 1]];
}
