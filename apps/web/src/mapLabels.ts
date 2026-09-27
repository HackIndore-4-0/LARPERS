export type MapPoint = [number, number];

const distanceToSegment = (
  point: MapPoint,
  start: MapPoint,
  end: MapPoint,
): number => {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0)
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const position = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(
    point[0] - (start[0] + position * dx),
    point[1] - (start[1] + position * dy),
  );
};

export function isPointInPolygon(point: MapPoint, ring: MapPoint[]): boolean {
  let inside = false;
  for (
    let current = 0, previous = ring.length - 1;
    current < ring.length;
    previous = current++
  ) {
    const a = ring[current]!;
    const b = ring[previous]!;
    const crosses =
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function polygonCentroid(ring: MapPoint[]): MapPoint | null {
  let areaTwice = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    const cross = current[0] * next[1] - next[0] * current[1];
    areaTwice += cross;
    x += (current[0] + next[0]) * cross;
    y += (current[1] + next[1]) * cross;
  }
  if (Math.abs(areaTwice) < Number.EPSILON) return null;
  return [x / (3 * areaTwice), y / (3 * areaTwice)];
}

function clearance(point: MapPoint, ring: MapPoint[]): number {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ring.length; index += 1) {
    distance = Math.min(
      distance,
      distanceToSegment(point, ring[index]!, ring[(index + 1) % ring.length]!),
    );
  }
  return distance;
}

/**
 * Returns a stable point inside a footprint. A validated area centroid is one
 * candidate; a bounded grid search moves concave-footprint labels away from
 * edges and from centroids which fall outside the polygon.
 */
export function interiorLabelPoint(ring: MapPoint[]): MapPoint {
  const points =
    ring.length > 1 &&
    ring[0]![0] === ring.at(-1)![0] &&
    ring[0]![1] === ring.at(-1)![1]
      ? ring.slice(0, -1)
      : ring;
  if (points.length < 3) return points[0] ?? [0, 0];

  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const candidates: MapPoint[] = [];
  const centroid = polygonCentroid(points);
  if (centroid && isPointInPolygon(centroid, points)) candidates.push(centroid);
  const boxCenter: MapPoint = [(minX + maxX) / 2, (minY + maxY) / 2];
  if (isPointInPolygon(boxCenter, points)) candidates.push(boxCenter);

  const steps = 18;
  for (let row = 0; row <= steps; row += 1) {
    for (let column = 0; column <= steps; column += 1) {
      const candidate: MapPoint = [
        minX + ((column + 0.5) / (steps + 1)) * (maxX - minX),
        minY + ((row + 0.5) / (steps + 1)) * (maxY - minY),
      ];
      if (isPointInPolygon(candidate, points)) candidates.push(candidate);
    }
  }

  return candidates.reduce(
    (best, candidate) =>
      clearance(candidate, points) > clearance(best, points) ? candidate : best,
    candidates[0] ?? points[0]!,
  );
}

export const isFallbackBuildingName = (name: string): boolean =>
  /^Building\s+\d+$/i.test(name.trim());

export function splitBuildingLabel(name: string): string[] {
  const normalized = name.trim();
  if (normalized.length <= 18 || !/[\s,]/.test(normalized)) return [normalized];
  const words = normalized.split(/[\s,]+/).filter(Boolean);
  if (words.length < 2) return [normalized];
  let bestIndex = 1;
  let bestDifference = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index += 1) {
    const first = words.slice(0, index).join(" ");
    const second = words.slice(index).join(" ");
    const difference = Math.abs(first.length - second.length);
    if (difference < bestDifference) {
      bestIndex = index;
      bestDifference = difference;
    }
  }
  return [
    words.slice(0, bestIndex).join(" "),
    words.slice(bestIndex).join(" "),
  ];
}

export function buildingLabelPriority(name: string, area: number): number {
  const important =
    /central library|\batc\b|\blt\b|central workshop|pharmacy dept/i.test(name);
  return area + (important ? 1_000_000 : 0);
}
