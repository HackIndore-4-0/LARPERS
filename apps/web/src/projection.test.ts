import { afterEach, describe, expect, it, vi } from "vitest";
import type { LonLat } from "@campus-access/shared";
import { clientPointToSvg, createSvgProjection } from "./projection";

const campus: LonLat[] = [
  [75.869, 22.7245],
  [75.8743, 22.728],
  [75.872, 22.726],
];

afterEach(() => vi.unstubAllGlobals());

describe("SVG campus projection", () => {
  it("round trips WGS84 longitude/latitude", () => {
    const projection = createSvgProjection(campus);
    const restored = projection.unproject(projection.project(campus[2]!));
    expect(restored[0]).toBeCloseTo(campus[2]![0], 8);
    expect(restored[1]).toBeCloseTo(campus[2]![1], 8);
  });

  it("preserves known feature alignment and orientation", () => {
    const projection = createSvgProjection(campus);
    const southwest = projection.project(campus[0]!);
    const northeast = projection.project(campus[1]!);
    expect(northeast[0]).toBeGreaterThan(southwest[0]);
    expect(northeast[1]).toBeLessThan(southwest[1]);
    expect(projection.project(campus[2]!)).toEqual(
      projection.project(campus[2]!),
    );
  });

  it("converts an SVG click back to the matching map coordinate", () => {
    const projection = createSvgProjection(campus, 844, 390);
    const svgPoint = projection.project([75.8715, 22.7255]);
    const coordinate = projection.unproject(svgPoint);
    expect(coordinate).toEqual(
      expect.arrayContaining([expect.any(Number), expect.any(Number)]),
    );
    expect(coordinate[0]).toBeCloseTo(75.8715, 8);
    expect(coordinate[1]).toBeCloseTo(22.7255, 8);
  });
});

describe("SVG client point conversion", () => {
  it("inverts the actual screen CTM through a viewBox and transformed world group", () => {
    vi.stubGlobal(
      "DOMPoint",
      class {
        constructor(
          public x: number,
          public y: number,
        ) {}

        matrixTransform(matrix: DOMMatrix): { x: number; y: number } {
          return {
            x: matrix.a * this.x + matrix.c * this.y + matrix.e,
            y: matrix.b * this.x + matrix.d * this.y + matrix.f,
          };
        }
      },
    );

    // viewBox="100 50 500 250" at 1000x500 CSS pixels, followed by
    // translate(40 25) scale(1.6), yields x'=3.2x-100, y'=3.2y-20.
    const inverse = {
      a: 1 / 3.2,
      b: 0,
      c: 0,
      d: 1 / 3.2,
      e: 100 / 3.2,
      f: 20 / 3.2,
    } as DOMMatrix;
    const element = {
      getScreenCTM: () => ({ inverse: () => inverse }),
    } as unknown as SVGGraphicsElement;

    expect(clientPointToSvg(element, 700, 364)).toEqual([250, 120]);
  });

  it("does not guess coordinates while the SVG has no screen transform", () => {
    const element = {
      getScreenCTM: () => null,
    } as unknown as SVGGraphicsElement;
    expect(clientPointToSvg(element, 400, 300)).toBeNull();
  });
});
