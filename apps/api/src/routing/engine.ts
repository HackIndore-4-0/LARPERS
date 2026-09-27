import type { LonLat, TravelProfile } from "@campus-access/shared";
import {
  distanceMeters,
  sameCoordinate,
  snapToSegment,
  type Snap,
} from "./geometry.js";
import type {
  RouteOptions,
  RoutingFeature,
  RoutingResult,
  Segment,
} from "./types.js";

export const MAX_APPROACH_DISTANCE_METERS = 120;

interface Arc {
  to: string;
  cost: number;
  distance: number;
  featureId: string;
  coordinates: LonLat[];
}

interface SnappedSegment extends Snap {
  segment: Segment;
}

function profileCost(
  feature: RoutingFeature,
  profile: TravelProfile,
  length: number,
): number {
  if (feature.blocked) return Infinity;
  if (profile === "wheelchair") {
    if (
      feature.classification === "shortcut" ||
      feature.stairs === "yes" ||
      feature.wheelchairAccess === "no"
    )
      return Infinity;
    if (feature.widthMeters !== null && feature.widthMeters < 0.9)
      return Infinity;
    if (feature.slopePercent !== null && Math.abs(feature.slopePercent) > 6)
      return Infinity;
    const unknownCount =
      Number(feature.widthMeters === null) +
      Number(feature.slopePercent === null) +
      Number(feature.surface === null) +
      Number(feature.wheelchairAccess === "unknown");
    return length * (1 + unknownCount * 0.4);
  }
  let multiplier = 1;
  if (profile === "heavy_luggage") {
    if (feature.stairs === "yes") multiplier += 2.5;
    if (feature.slopePercent !== null && Math.abs(feature.slopePercent) > 5)
      multiplier += 1.5;
    if (
      feature.surface &&
      ["ground", "gravel", "sand", "dirt"].includes(feature.surface)
    )
      multiplier += 1;
  }
  return length * multiplier;
}

function nodeKey(sourceNodeId: string, levelKey: string | null): string {
  const level = levelKey === null || levelKey === "0" ? "ground" : levelKey;
  return `${sourceNodeId}@${level}`;
}

export function buildSegments(
  features: RoutingFeature[],
  profile: TravelProfile,
): Segment[] {
  const segments: Segment[] = [];
  for (const feature of features) {
    for (let index = 0; index < feature.coordinates.length - 1; index += 1) {
      const from = feature.coordinates[index];
      const to = feature.coordinates[index + 1];
      const fromId = feature.orderedNodeIds[index];
      const toId = feature.orderedNodeIds[index + 1];
      if (!from || !to || !fromId || !toId) continue;
      const length = distanceMeters(from, to);
      const cost = profileCost(feature, profile, length);
      if (!Number.isFinite(cost) || length <= 0) continue;
      segments.push({
        key: `${feature.id}:${index}`,
        feature,
        index,
        fromNode: nodeKey(fromId, feature.levelKey),
        toNode: nodeKey(toId, feature.levelKey),
        from,
        to,
        length,
        cost,
      });
    }
  }
  return segments;
}

function nearest(
  point: LonLat,
  segments: Segment[],
  maxDistance: number,
): SnappedSegment | null {
  let best: SnappedSegment | null = null;
  for (const segment of segments) {
    const snap = snapToSegment(point, segment.from, segment.to);
    if (
      snap.distanceMeters <= maxDistance &&
      (!best ||
        snap.distanceMeters < best.distanceMeters ||
        (snap.distanceMeters === best.distanceMeters &&
          segment.key < best.segment.key))
    ) {
      best = { ...snap, segment };
    }
  }
  return best;
}

function addArc(graph: Map<string, Arc[]>, from: string, arc: Arc): void {
  const list = graph.get(from) ?? [];
  list.push(arc);
  graph.set(from, list);
}

function connect(
  graph: Map<string, Arc[]>,
  from: string,
  to: string,
  segment: Segment,
  fractionFrom: number,
  fractionTo: number,
  coordinateFrom: LonLat,
  coordinateTo: LonLat,
): void {
  const ratio = Math.abs(fractionTo - fractionFrom);
  addArc(graph, from, {
    to,
    cost: segment.cost * ratio,
    distance: segment.length * ratio,
    featureId: segment.feature.id,
    coordinates: [coordinateFrom, coordinateTo],
  });
}

export function routeFeatures(
  features: RoutingFeature[],
  options: RouteOptions,
): RoutingResult | null {
  const segments = buildSegments(features, options.profile);
  const maximum = options.maxSnapDistanceMeters ?? MAX_APPROACH_DISTANCE_METERS;
  const start = nearest(options.start, segments, maximum);
  const destination = nearest(options.destination, segments, maximum);
  if (!start || !destination) return null;

  const graph = new Map<string, Arc[]>();
  for (const segment of segments) {
    connect(
      graph,
      segment.fromNode,
      segment.toNode,
      segment,
      0,
      1,
      segment.from,
      segment.to,
    );
    connect(
      graph,
      segment.toNode,
      segment.fromNode,
      segment,
      1,
      0,
      segment.to,
      segment.from,
    );
  }
  connect(
    graph,
    "route:start",
    start.segment.fromNode,
    start.segment,
    start.fraction,
    0,
    start.coordinates,
    start.segment.from,
  );
  connect(
    graph,
    "route:start",
    start.segment.toNode,
    start.segment,
    start.fraction,
    1,
    start.coordinates,
    start.segment.to,
  );
  connect(
    graph,
    start.segment.fromNode,
    "route:start",
    start.segment,
    0,
    start.fraction,
    start.segment.from,
    start.coordinates,
  );
  connect(
    graph,
    start.segment.toNode,
    "route:start",
    start.segment,
    1,
    start.fraction,
    start.segment.to,
    start.coordinates,
  );
  connect(
    graph,
    "route:end",
    destination.segment.fromNode,
    destination.segment,
    destination.fraction,
    0,
    destination.coordinates,
    destination.segment.from,
  );
  connect(
    graph,
    "route:end",
    destination.segment.toNode,
    destination.segment,
    destination.fraction,
    1,
    destination.coordinates,
    destination.segment.to,
  );
  connect(
    graph,
    destination.segment.fromNode,
    "route:end",
    destination.segment,
    0,
    destination.fraction,
    destination.segment.from,
    destination.coordinates,
  );
  connect(
    graph,
    destination.segment.toNode,
    "route:end",
    destination.segment,
    1,
    destination.fraction,
    destination.segment.to,
    destination.coordinates,
  );
  if (start.segment.key === destination.segment.key) {
    connect(
      graph,
      "route:start",
      "route:end",
      start.segment,
      start.fraction,
      destination.fraction,
      start.coordinates,
      destination.coordinates,
    );
    connect(
      graph,
      "route:end",
      "route:start",
      start.segment,
      destination.fraction,
      start.fraction,
      destination.coordinates,
      start.coordinates,
    );
  }

  const distances = new Map<string, number>([["route:start", 0]]);
  const previous = new Map<string, { node: string; arc: Arc }>();
  const open = new Set<string>(["route:start"]);
  while (open.size) {
    let current: string | null = null;
    for (const candidate of open)
      if (
        current === null ||
        (distances.get(candidate) ?? Infinity) <
          (distances.get(current) ?? Infinity)
      )
        current = candidate;
    if (current === null) break;
    open.delete(current);
    if (current === "route:end") break;
    for (const arc of graph.get(current) ?? []) {
      const next = (distances.get(current) ?? Infinity) + arc.cost;
      if (next < (distances.get(arc.to) ?? Infinity)) {
        distances.set(arc.to, next);
        previous.set(arc.to, { node: current, arc });
        open.add(arc.to);
      }
    }
  }
  if (!previous.has("route:end")) return null;
  const arcs: Arc[] = [];
  let cursor = "route:end";
  while (cursor !== "route:start") {
    const step = previous.get(cursor);
    if (!step) return null;
    arcs.push(step.arc);
    cursor = step.node;
  }
  arcs.reverse();
  const coordinates: LonLat[] = [];
  for (const arc of arcs) {
    for (const coordinate of arc.coordinates)
      if (!sameCoordinate(coordinates.at(-1), coordinate))
        coordinates.push(coordinate);
  }
  const featureIds = arcs
    .map((arc) => arc.featureId)
    .filter((id, index, all) => index === 0 || id !== all[index - 1]);
  const distance = arcs.reduce((sum, arc) => sum + arc.distance, 0);
  const warnings =
    options.profile === "wheelchair" &&
    arcs.some((arc) => {
      const feature = features.find((item) => item.id === arc.featureId);
      return (
        feature &&
        (feature.widthMeters === null ||
          feature.slopePercent === null ||
          feature.surface === null)
      );
    })
      ? [
          "Some accessibility details are unknown; this is not a certified interior-accessible route.",
        ]
      : [];
  return {
    featureIds,
    coordinates,
    distanceMeters: Math.round(distance),
    directions: featureIds
      .map(
        (id, index) => `Continue on campus path ${index + 1}${id ? "" : ""}.`,
      )
      .concat(`Arrive after about ${Math.round(distance)} m.`),
    warnings,
  };
}
