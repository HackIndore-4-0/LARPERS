import { z } from "zod";
import type { LineString, Polygon } from "geojson";

export const apiErrorCodes = [
  "no_route",
  "invalid_input",
  "not_found",
  "unauthorized",
  "service_unavailable",
] as const;

export const coordinateSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);
export type LonLat = z.infer<typeof coordinateSchema>;

export const travelProfileSchema = z.enum([
  "healthy",
  "wheelchair",
  "heavy_luggage",
]);
export type TravelProfile = z.infer<typeof travelProfileSchema>;

export const routeTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("coordinate"), coordinates: coordinateSchema }),
  z.object({
    kind: z.literal("building"),
    buildingId: z.string().min(1).max(160),
  }),
]);
export type RouteTarget = z.infer<typeof routeTargetSchema>;

export const routeRequestSchema = z.object({
  start: routeTargetSchema,
  destination: routeTargetSchema,
  profile: travelProfileSchema,
});
export type RouteRequest = z.infer<typeof routeRequestSchema>;

export interface BuildingSummary {
  id: string;
  name: string;
  levels: number | null;
  footprint: Polygon;
  approach: LonLat | null;
  approachApproximate: boolean;
  groundFloorLiftAvailable: boolean | null;
}

export interface RouteFeatureSummary {
  id: string;
  geometry: LineString;
  classification: "main" | "shortcut";
  blocked: boolean;
}

export interface PublicPoint {
  id: string;
  name: string;
  note: string;
  coordinates: LonLat;
  createdAt: string;
  updatedAt: string;
}

export interface MapPayload {
  revision: number;
  buildings: BuildingSummary[];
  routes: RouteFeatureSummary[];
  points: PublicPoint[];
}

export interface RouteDetails {
  id: string;
  publicNote: string | null;
  blocked: boolean;
  blockReason: string | null;
  expiresAt: string | null;
  classification: "main" | "shortcut";
  surface: string | null;
  stairs: "yes" | "no" | "unknown";
  slopePercent: number | null;
  widthMeters: number | null;
}

export interface RouteSuccess {
  status: "ok";
  revision: number;
  featureIds: string[];
  geometry: LineString;
  distanceMeters: number;
  directions: string[];
  warnings: string[];
  startApproachApproximate: boolean;
  destinationApproachApproximate: boolean;
}

export interface NoRoute {
  status: "no_route";
  revision: number;
  message: string;
}

export type RouteResponse = RouteSuccess | NoRoute;

export const floorNumberSchema = z.coerce.number().int().min(-10).max(200);
export const layoutBlockSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(100),
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .refine(
    (block) =>
      block.x + block.width <= 1.000001 && block.y + block.height <= 1.000001,
    {
      message: "Block must stay inside the floor canvas",
    },
  );
export const floorLayoutSchema = z.object({
  canvasWidth: z.number().finite().int().min(200).max(4000),
  canvasHeight: z.number().finite().int().min(200).max(4000),
  blocks: z.array(layoutBlockSchema).max(300),
});
export type FloorLayout = z.infer<typeof floorLayoutSchema>;

export interface FloorSummary {
  number: number;
  updatedAt: string;
  version: number;
}

export interface SavedFloor extends FloorSummary {
  buildingId: string;
  layout: FloorLayout;
}

export const editorLoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(500),
});

export const editorRouteUpdateSchema = z
  .object({
    publicNote: z.string().trim().max(500).nullable().optional(),
    blocked: z.boolean(),
    blockReason: z.string().trim().max(300).nullable().optional(),
    expiresAt: z.iso.datetime().nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.blocked && !value.blockReason) {
      context.addIssue({
        code: "custom",
        path: ["blockReason"],
        message: "A block reason is required",
      });
    }
  });

export const pointWriteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  note: z.string().trim().max(500).default(""),
  coordinates: coordinateSchema,
});

export const messagePatchSchema = z
  .object({
    status: z.enum(["saved", "addressed"]).optional(),
    editorAnnotation: z.string().trim().max(1000).nullable().optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined || value.editorAnnotation !== undefined,
    {
      message: "At least one change is required",
    },
  );

export const visitorMessageSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  longitude: z.coerce.number().finite().min(-180).max(180),
  latitude: z.coerce.number().finite().min(-90).max(90),
});

export const messageStatusSchema = z.enum(["incoming", "saved", "addressed"]);

export interface VisitorMessage {
  id: string;
  originalText: string;
  coordinates: LonLat;
  status: "incoming" | "saved" | "addressed";
  editorAnnotation: string | null;
  hasEvidence: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApiErrorBody {
  error: { code: (typeof apiErrorCodes)[number]; message: string };
}
