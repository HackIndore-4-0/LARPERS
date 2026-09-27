import type { LonLat, TravelProfile } from "@campus-access/shared";

export interface RoutingFeature {
  id: string;
  orderedNodeIds: string[];
  coordinates: LonLat[];
  classification: "main" | "shortcut";
  levelKey: string | null;
  surface: string | null;
  slopePercent: number | null;
  widthMeters: number | null;
  stairs: "yes" | "no" | "unknown";
  wheelchairAccess: "yes" | "no" | "unknown";
  blocked: boolean;
}

export interface RoutingResult {
  featureIds: string[];
  coordinates: LonLat[];
  distanceMeters: number;
  directions: string[];
  warnings: string[];
}

export interface Segment {
  key: string;
  feature: RoutingFeature;
  index: number;
  fromNode: string;
  toNode: string;
  from: LonLat;
  to: LonLat;
  length: number;
  cost: number;
}

export interface RouteOptions {
  start: LonLat;
  destination: LonLat;
  profile: TravelProfile;
  maxSnapDistanceMeters?: number;
}
