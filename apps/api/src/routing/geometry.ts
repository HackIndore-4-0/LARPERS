import type { LonLat } from "@campus-access/shared";

const EARTH_RADIUS = 6_371_008.8;
const radians = (value: number): number => (value * Math.PI) / 180;

export function distanceMeters(a: LonLat, b: LonLat): number {
  const latitude = radians((a[1] + b[1]) / 2);
  const x = radians(b[0] - a[0]) * Math.cos(latitude);
  const y = radians(b[1] - a[1]);
  return Math.hypot(x, y) * EARTH_RADIUS;
}

export interface Snap {
  coordinates: LonLat;
  fraction: number;
  distanceMeters: number;
}

export function snapToSegment(point: LonLat, start: LonLat, end: LonLat): Snap {
  const latitude = radians(point[1]);
  const scaleX = EARTH_RADIUS * Math.cos(latitude);
  const scaleY = EARTH_RADIUS;
  const x1 = radians(start[0] - point[0]) * scaleX;
  const y1 = radians(start[1] - point[1]) * scaleY;
  const x2 = radians(end[0] - point[0]) * scaleX;
  const y2 = radians(end[1] - point[1]) * scaleY;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const denominator = dx * dx + dy * dy;
  const fraction =
    denominator === 0
      ? 0
      : Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / denominator));
  const x = x1 + fraction * dx;
  const y = y1 + fraction * dy;
  return {
    coordinates: [
      start[0] + (end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
    ],
    fraction,
    distanceMeters: Math.hypot(x, y),
  };
}

export function sameCoordinate(a: LonLat | undefined, b: LonLat): boolean {
  return Boolean(
    a && Math.abs(a[0] - b[0]) < 1e-10 && Math.abs(a[1] - b[1]) < 1e-10,
  );
}
