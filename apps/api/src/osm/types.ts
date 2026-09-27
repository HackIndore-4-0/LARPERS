import type { LonLat } from "@campus-access/shared";
import type { LineString, Polygon } from "geojson";

export interface OsmNode {
  id: string;
  coordinates: LonLat;
  tags: Record<string, string>;
}

export interface OsmWay {
  id: string;
  nodeIds: string[];
  tags: Record<string, string>;
}

export interface OsmExtract {
  nodes: Map<string, OsmNode>;
  ways: OsmWay[];
}

export interface ImportedBuilding {
  id: string;
  sourceOsmId: string;
  name: string;
  levels: number | null;
  footprint: Polygon;
  approach: LonLat | null;
  approachApproximate: boolean;
  groundFloorLiftAvailable: boolean | null;
}

export interface ImportedRouteFeature {
  id: string;
  sourceOsmId: string;
  orderedNodeIds: string[];
  geometry: LineString;
  classification: "main";
  levelKey: string | null;
  surface: string | null;
  slopePercent: number | null;
  widthMeters: number | null;
  stairs: "yes" | "no" | "unknown";
  wheelchairAccess: "yes" | "no" | "unknown";
  osmTags: Record<string, string>;
}

export interface OsmImportModel {
  buildings: ImportedBuilding[];
  routes: ImportedRouteFeature[];
}
