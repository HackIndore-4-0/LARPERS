import { describe, expect, it } from "vitest";
import { routeFeatures } from "./engine.js";
import type { RoutingFeature } from "./types.js";

const feature = (
  id: string,
  nodes: string[],
  coordinates: [number, number][],
  changes: Partial<RoutingFeature> = {},
): RoutingFeature => ({
  id,
  orderedNodeIds: nodes,
  coordinates,
  classification: "main",
  levelKey: null,
  surface: null,
  slopePercent: null,
  widthMeters: null,
  stairs: "no",
  wheelchairAccess: "unknown",
  blocked: false,
  ...changes,
});

describe("routing engine", () => {
  const connected = [
    feature(
      "a",
      ["1", "2"],
      [
        [75, 22],
        [75.001, 22],
      ],
    ),
    feature(
      "b",
      ["2", "3"],
      [
        [75.001, 22],
        [75.001, 22.001],
      ],
    ),
  ];

  it("returns continuous longitude/latitude geometry through a real junction", () => {
    const route = routeFeatures(connected, {
      start: [75.0002, 22],
      destination: [75.001, 22.0008],
      profile: "healthy",
    });
    expect(route?.featureIds).toEqual(["a", "b"]);
    expect(route?.coordinates[0]).toEqual([75.0002, 22]);
    expect(route?.coordinates.at(-1)).toEqual([75.001, 22.0008]);
  });

  it("handles same-edge and reversed routes using partial edges", () => {
    const forward = routeFeatures(connected, {
      start: [75.0002, 22],
      destination: [75.0008, 22],
      profile: "healthy",
    });
    const reverse = routeFeatures(connected, {
      start: [75.0008, 22],
      destination: [75.0002, 22],
      profile: "healthy",
    });
    expect(forward?.featureIds).toEqual(["a"]);
    expect(reverse?.coordinates.at(-1)?.[0]).toBeCloseTo(75.0002);
  });

  it("does not invent a link at a visual crossing or between components", () => {
    const crossing = feature(
      "x",
      ["4", "5"],
      [
        [75.0005, 21.9995],
        [75.0005, 22.0005],
      ],
    );
    expect(
      routeFeatures([connected[0]!, crossing], {
        start: [75, 22],
        destination: [75.0005, 22.0004],
        profile: "healthy",
        maxSnapDistanceMeters: 20,
      }),
    ).toBeNull();
  });

  it("omits blocked features and restores them when unblocked", () => {
    expect(
      routeFeatures([{ ...connected[0]!, blocked: true }, connected[1]!], {
        start: [75, 22],
        destination: [75.001, 22.0008],
        profile: "healthy",
        maxSnapDistanceMeters: 20,
      }),
    ).toBeNull();
    expect(
      routeFeatures(connected, {
        start: [75, 22],
        destination: [75.001, 22.0008],
        profile: "healthy",
        maxSnapDistanceMeters: 20,
      }),
    ).not.toBeNull();
  });

  it("excludes shortcuts and known barriers for wheelchairs", () => {
    const shortcut = feature(
      "shortcut",
      ["1", "3"],
      [
        [75, 22],
        [75.001, 22.001],
      ],
      { classification: "shortcut" },
    );
    expect(
      routeFeatures([shortcut], {
        start: [75, 22],
        destination: [75.001, 22.001],
        profile: "wheelchair",
        maxSnapDistanceMeters: 20,
      }),
    ).toBeNull();
    expect(
      routeFeatures([shortcut], {
        start: [75, 22],
        destination: [75.001, 22.001],
        profile: "healthy",
        maxSnapDistanceMeters: 20,
      }),
    ).not.toBeNull();
  });

  it("keeps different levels disconnected", () => {
    const upper = feature(
      "upper",
      ["2", "9"],
      [
        [75.001, 22],
        [75.001, 22.001],
      ],
      { levelKey: "1" },
    );
    expect(
      routeFeatures([connected[0]!, upper], {
        start: [75, 22],
        destination: [75.001, 22.001],
        profile: "healthy",
        maxSnapDistanceMeters: 20,
      }),
    ).toBeNull();
  });
});
