import type { LonLat } from "@campus-access/shared";

const RADIUS = 6_378_137;
const radians = (value: number): number => (value * Math.PI) / 180;
const degrees = (value: number): number => (value * 180) / Math.PI;

export interface SvgProjection {
  project(coordinates: LonLat): [number, number];
  unproject(point: [number, number]): LonLat;
  width: number;
  height: number;
}

/**
 * Convert a browser pointer position to the local coordinates of an SVG
 * element. The element's screen CTM includes its viewBox, aspect-ratio
 * letterboxing, CSS layout and every ancestor transform.
 */
export function clientPointToSvg(
  element: SVGGraphicsElement,
  clientX: number,
  clientY: number,
): [number, number] | null {
  const screen = element.getScreenCTM();
  if (!screen) return null;
  try {
    const local = new DOMPoint(clientX, clientY).matrixTransform(
      screen.inverse(),
    );
    return [local.x, local.y];
  } catch {
    // A detached/hidden SVG can briefly have a singular CTM during layout.
    return null;
  }
}

function mercator([longitude, latitude]: LonLat): [number, number] {
  const clamped = Math.max(-85, Math.min(85, latitude));
  return [
    RADIUS * radians(longitude),
    -RADIUS * Math.log(Math.tan(Math.PI / 4 + radians(clamped) / 2)),
  ];
}

function inverseMercator([x, y]: [number, number]): LonLat {
  return [
    degrees(x / RADIUS),
    degrees(2 * Math.atan(Math.exp(-y / RADIUS)) - Math.PI / 2),
  ];
}

/** A single local Web Mercator fit used by every campus SVG layer and inverse click conversion. */
export function createSvgProjection(
  coordinates: LonLat[],
  width = 1000,
  height = 720,
  padding = 36,
): SvgProjection {
  const source = coordinates.length ? coordinates : [[0, 0] as LonLat];
  const raw = source.map(mercator);
  const xs = raw.map((point) => point[0]);
  const ys = raw.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const sourceWidth = Math.max(1, maxX - minX);
  const sourceHeight = Math.max(1, maxY - minY);
  const scale = Math.min(
    (width - padding * 2) / sourceWidth,
    (height - padding * 2) / sourceHeight,
  );
  const offsetX = (width - sourceWidth * scale) / 2;
  const offsetY = (height - sourceHeight * scale) / 2;
  return {
    width,
    height,
    project(coordinate) {
      const [x, y] = mercator(coordinate);
      return [offsetX + (x - minX) * scale, offsetY + (y - minY) * scale];
    },
    unproject([x, y]) {
      return inverseMercator([
        minX + (x - offsetX) / scale,
        minY + (y - offsetY) / scale,
      ]);
    },
  };
}
