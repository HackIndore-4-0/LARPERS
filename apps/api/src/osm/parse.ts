import { XMLParser } from "fast-xml-parser";
import type { LonLat } from "@campus-access/shared";
import type {
  ImportedBuilding,
  ImportedRouteFeature,
  OsmExtract,
  OsmImportModel,
  OsmNode,
  OsmWay,
} from "./types.js";

type XmlRecord = Record<string, unknown>;
const array = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const attribute = (record: XmlRecord, name: string): string => {
  const value = record[`@_${name}`];
  if (value === undefined || value === null)
    throw new Error(`Missing OSM attribute ${name}`);
  return String(value);
};

function tags(record: XmlRecord): Record<string, string> {
  return Object.fromEntries(
    array(record.tag as XmlRecord | XmlRecord[] | undefined).map((tag) => [
      attribute(tag, "k"),
      attribute(tag, "v"),
    ]),
  );
}

export function parseOsmXml(xml: string): OsmExtract {
  const parsed = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: false,
  }).parse(xml) as { osm?: XmlRecord };
  if (!parsed.osm) throw new Error("Invalid OSM XML: missing osm root");
  const nodes = new Map<string, OsmNode>();
  for (const raw of array(
    parsed.osm.node as XmlRecord | XmlRecord[] | undefined,
  )) {
    const coordinates: LonLat = [
      Number(attribute(raw, "lon")),
      Number(attribute(raw, "lat")),
    ];
    if (!Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1]))
      throw new Error("Invalid OSM coordinate");
    const node = { id: attribute(raw, "id"), coordinates, tags: tags(raw) };
    if (nodes.has(node.id)) throw new Error(`Duplicate OSM node ${node.id}`);
    nodes.set(node.id, node);
  }
  const ways: OsmWay[] = array(
    parsed.osm.way as XmlRecord | XmlRecord[] | undefined,
  ).map((raw) => ({
    id: attribute(raw, "id"),
    nodeIds: array(raw.nd as XmlRecord | XmlRecord[] | undefined).map((node) =>
      attribute(node, "ref"),
    ),
    tags: tags(raw),
  }));
  return { nodes, ways };
}

const pedestrianHighways = new Set([
  "footway",
  "path",
  "pedestrian",
  "steps",
  "living_street",
  "service",
  "residential",
  "unclassified",
  "track",
  "corridor",
]);

function finiteNumber(value: string | undefined): number | null {
  if (!value) return null;
  const number = Number(value.replace(/\s*(m|meters?)$/i, ""));
  return Number.isFinite(number) ? number : null;
}

function inclinePercent(value: string | undefined): number | null {
  if (!value || ["up", "down"].includes(value)) return null;
  const match = /^\s*([+-]?\d+(?:\.\d+)?)\s*(%|°)?\s*$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === "°" ? Math.tan((amount * Math.PI) / 180) * 100 : amount;
}

function accessValue(value: string | undefined): "yes" | "no" | "unknown" {
  if (["yes", "designated", "permissive"].includes(value ?? "")) return "yes";
  if (["no", "private"].includes(value ?? "")) return "no";
  return "unknown";
}

function coordinates(extract: OsmExtract, way: OsmWay): LonLat[] {
  return way.nodeIds.map((id) => {
    const node = extract.nodes.get(id);
    if (!node)
      throw new Error(`OSM way ${way.id} references missing node ${id}`);
    return node.coordinates;
  });
}

function centroid(ring: LonLat[]): LonLat {
  const total = ring.reduce(
    (sum, point) => [sum[0] + point[0], sum[1] + point[1]] as LonLat,
    [0, 0] as LonLat,
  );
  return [total[0] / ring.length, total[1] / ring.length];
}

function squaredDistance(a: LonLat, b: LonLat): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

export function extractOsmImportModel(extract: OsmExtract): OsmImportModel {
  const routes: ImportedRouteFeature[] = [];
  for (const way of extract.ways) {
    const highway = way.tags.highway;
    const foot = accessValue(way.tags.foot);
    // Campus service ways use `access=private` for controlled campus entry;
    // that is not a pedestrian barrier after entry. Explicit foot/access
    // prohibitions remain authoritative.
    const accessBlocksWalking = way.tags.access === "no" && foot !== "yes";
    if (
      !highway ||
      !pedestrianHighways.has(highway) ||
      foot === "no" ||
      accessBlocksWalking ||
      way.nodeIds.length < 2
    )
      continue;
    routes.push({
      id: `osm-route-${way.id}`,
      sourceOsmId: way.id,
      orderedNodeIds: way.nodeIds,
      geometry: {
        type: "LineString",
        coordinates: coordinates(extract, way) as number[][],
      },
      classification: "main",
      levelKey: way.tags.layer ?? way.tags.level ?? null,
      surface: way.tags.surface ?? null,
      slopePercent: inclinePercent(way.tags.incline),
      widthMeters: finiteNumber(way.tags.width),
      stairs:
        highway === "steps" || way.tags.steps
          ? "yes"
          : highway
            ? "no"
            : "unknown",
      wheelchairAccess: accessValue(way.tags.wheelchair),
      osmTags: way.tags,
    });
  }
  const routeVertices = routes.flatMap(
    (route) => route.geometry.coordinates as LonLat[],
  );
  const buildings: ImportedBuilding[] = [];
  for (const way of extract.ways) {
    if (
      !way.tags.building ||
      way.tags.building === "no" ||
      way.nodeIds.length < 4 ||
      way.nodeIds[0] !== way.nodeIds.at(-1)
    )
      continue;
    const ring = coordinates(extract, way);
    const center = centroid(ring);
    const approach = routeVertices.reduce<LonLat | null>(
      (best, point) =>
        !best || squaredDistance(point, center) < squaredDistance(best, center)
          ? point
          : best,
      null,
    );
    const rawLevels = Number(way.tags["building:levels"] ?? way.tags.levels);
    buildings.push({
      id: `osm-building-${way.id}`,
      sourceOsmId: way.id,
      name: way.tags.name ?? `Building ${way.id}`,
      levels: Number.isInteger(rawLevels) && rawLevels >= 0 ? rawLevels : null,
      footprint: { type: "Polygon", coordinates: [ring as number[][]] },
      approach,
      approachApproximate: approach !== null,
      groundFloorLiftAvailable:
        way.tags.elevator === "yes" || way.tags.lift === "yes" ? true : null,
    });
  }
  return { buildings, routes };
}

export function parseOsmImportModel(xml: string): OsmImportModel {
  return extractOsmImportModel(parseOsmXml(xml));
}
