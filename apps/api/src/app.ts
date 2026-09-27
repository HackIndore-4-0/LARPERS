import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type Express, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import {
  editorLoginSchema,
  editorRouteUpdateSchema,
  floorLayoutSchema,
  floorNumberSchema,
  messagePatchSchema,
  messageStatusSchema,
  pointWriteSchema,
  routeRequestSchema,
  visitorMessageSchema,
  type BuildingSummary,
  type FloorLayout,
  type MapPayload,
  type PublicPoint,
  type RouteDetails,
  type RouteResponse,
  type VisitorMessage,
} from "@campus-access/shared";
import type { Database } from "./db.js";
import { inTransaction } from "./db.js";
import { type EditorAuth, requireMutationOrigin } from "./auth.js";
import { ApiError, errorHandler, sendError } from "./errors.js";
import type { EvidenceStore } from "./media.js";
import { routeFeatures } from "./routing/engine.js";
import type { RoutingFeature } from "./routing/types.js";

interface AppDependencies {
  database: Database;
  auth: EditorAuth;
  evidence: EvidenceStore;
  webOrigin: string;
}

const asyncRoute =
  (
    handler: (...args: Parameters<RequestHandler>) => Promise<void>,
  ): RequestHandler =>
  (request, response, next) =>
    void handler(request, response, next).catch(next);

function parseJson<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

function messageRow(row: Record<string, unknown>): VisitorMessage {
  return {
    id: String(row.id),
    originalText: String(row.original_text),
    coordinates: [Number(row.longitude), Number(row.latitude)],
    status: row.status as VisitorMessage["status"],
    editorAnnotation:
      row.editor_annotation === null ? null : String(row.editor_annotation),
    hasEvidence: Boolean(row.cloudinary_public_id),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

async function expireBlocks(database: Database): Promise<void> {
  await inTransaction(database, async (client) => {
    const expired = await client.query(
      `UPDATE route_annotations SET blocked=false, block_reason=NULL, expires_at=NULL, version=version+1, updated_at=now()
       WHERE blocked=true AND expires_at IS NOT NULL AND expires_at <= now() RETURNING route_feature_id`,
    );
    if (expired.rowCount)
      await client.query(
        "UPDATE map_revision SET revision=revision+1, updated_at=now() WHERE singleton=true",
      );
  });
}

export function createApp({
  database,
  auth,
  evidence,
  webOrigin,
}: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({
      origin: webOrigin,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );
  app.use(requireMutationOrigin(webOrigin));
  app.use(express.json({ limit: "256kb" }));
  const loginLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const messageLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 12,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4 },
  });

  app.get("/api/health", (_request, response) =>
    response.json({ status: "ok" }),
  );

  app.get(
    "/api/map",
    asyncRoute(async (_request, response) => {
      await expireBlocks(database);
      const [revisionResult, buildingsResult, routesResult, pointsResult] =
        await Promise.all([
          database.query(
            "SELECT revision FROM map_revision WHERE singleton=true",
          ),
          database.query(
            "SELECT id,name,mapped_level_count,footprint,approach,approach_approximate,ground_floor_lift_available FROM buildings ORDER BY name",
          ),
          database.query(`SELECT f.id,f.geometry,f.classification,COALESCE(a.blocked,false) AS blocked
        FROM route_features f LEFT JOIN route_annotations a ON a.route_feature_id=f.id ORDER BY f.id`),
          database.query(
            "SELECT id,name,note,longitude,latitude,created_at,updated_at FROM public_points ORDER BY created_at",
          ),
        ]);
      const payload: MapPayload = {
        revision: Number(revisionResult.rows[0]?.revision ?? 1),
        buildings: buildingsResult.rows.map((row): BuildingSummary => ({
          id: row.id,
          name: row.name,
          levels: row.mapped_level_count,
          footprint: parseJson(row.footprint),
          approach: row.approach === null ? null : parseJson(row.approach),
          approachApproximate: row.approach_approximate,
          groundFloorLiftAvailable: row.ground_floor_lift_available,
        })),
        routes: routesResult.rows.map((row) => ({
          id: row.id,
          geometry: parseJson(row.geometry),
          classification: row.classification,
          blocked: row.blocked,
        })),
        points: pointsResult.rows.map((row): PublicPoint => ({
          id: row.id,
          name: row.name,
          note: row.note,
          coordinates: [row.longitude, row.latitude],
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        })),
      };
      response.json(payload);
    }),
  );

  app.get(
    "/api/routes/:id",
    asyncRoute(async (request, response) => {
      await expireBlocks(database);
      const result = await database.query(
        `SELECT f.id,f.classification,f.surface,f.stairs,f.slope_percent,f.width_meters,
      a.public_note,COALESCE(a.blocked,false) AS blocked,a.block_reason,a.expires_at
      FROM route_features f LEFT JOIN route_annotations a ON a.route_feature_id=f.id WHERE f.id=$1`,
        [request.params.id],
      );
      if (!result.rowCount)
        throw new ApiError(404, "not_found", "Route segment not found.");
      const row = result.rows[0];
      const details: RouteDetails = {
        id: row.id,
        publicNote: row.public_note,
        blocked: row.blocked,
        blockReason: row.block_reason,
        expiresAt: row.expires_at?.toISOString() ?? null,
        classification: row.classification,
        surface: row.surface,
        stairs: row.stairs,
        slopePercent: row.slope_percent,
        widthMeters: row.width_meters,
      };
      response.json(details);
    }),
  );

  app.get(
    "/api/routing/revision",
    asyncRoute(async (_request, response) => {
      await expireBlocks(database);
      const result = await database.query(
        "SELECT revision FROM map_revision WHERE singleton=true",
      );
      response.json({ revision: Number(result.rows[0]?.revision ?? 1) });
    }),
  );

  app.post(
    "/api/routing/route",
    asyncRoute(async (request, response) => {
      const parsed = routeRequestSchema.safeParse(request.body);
      if (!parsed.success)
        throw new ApiError(
          400,
          "invalid_input",
          "Choose a valid start, destination, and travel profile.",
        );
      await expireBlocks(database);
      const [featuresResult, buildingsResult, revisionResult] =
        await Promise.all([
          database.query(`SELECT f.id,f.ordered_node_ids,f.geometry,f.classification,f.level_key,f.surface,f.slope_percent,f.width_meters,
        f.stairs,f.wheelchair_access,COALESCE(a.blocked,false) AS blocked FROM route_features f
        LEFT JOIN route_annotations a ON a.route_feature_id=f.id`),
          database.query(
            "SELECT id,approach,approach_approximate FROM buildings",
          ),
          database.query(
            "SELECT revision FROM map_revision WHERE singleton=true",
          ),
        ]);
      const buildingMap = new Map(
        buildingsResult.rows.map((row) => [row.id, row]),
      );
      const resolveTarget = (
        target: typeof parsed.data.start,
      ): { coordinates: [number, number]; approximate: boolean } => {
        if (target.kind === "coordinate")
          return { coordinates: target.coordinates, approximate: false };
        const row = buildingMap.get(target.buildingId);
        if (!row?.approach)
          throw new ApiError(
            400,
            "no_route",
            "This building has no mapped outdoor approach.",
          );
        return {
          coordinates: parseJson(row.approach),
          approximate: row.approach_approximate,
        };
      };
      const start = resolveTarget(parsed.data.start);
      const destination = resolveTarget(parsed.data.destination);
      const features: RoutingFeature[] = featuresResult.rows.map((row) => ({
        id: row.id,
        orderedNodeIds: parseJson(row.ordered_node_ids),
        coordinates: parseJson<{ coordinates: [number, number][] }>(
          row.geometry,
        ).coordinates,
        classification: row.classification,
        levelKey: row.level_key,
        surface: row.surface,
        slopePercent: row.slope_percent,
        widthMeters: row.width_meters,
        stairs: row.stairs,
        wheelchairAccess: row.wheelchair_access,
        blocked: row.blocked,
      }));
      const result = routeFeatures(features, {
        start: start.coordinates,
        destination: destination.coordinates,
        profile: parsed.data.profile,
      });
      const revision = Number(revisionResult.rows[0]?.revision ?? 1);
      const body: RouteResponse = result
        ? {
            status: "ok",
            revision,
            featureIds: result.featureIds,
            geometry: { type: "LineString", coordinates: result.coordinates },
            distanceMeters: result.distanceMeters,
            directions: result.directions,
            warnings: result.warnings,
            startApproachApproximate: start.approximate,
            destinationApproachApproximate: destination.approximate,
          }
        : {
            status: "no_route",
            revision,
            message: "No route is currently available between these locations.",
          };
      response.json(body);
    }),
  );

  app.get(
    "/api/buildings/:id/floors",
    asyncRoute(async (request, response) => {
      const exists = await database.query(
        "SELECT 1 FROM buildings WHERE id=$1",
        [request.params.id],
      );
      if (!exists.rowCount)
        throw new ApiError(404, "not_found", "Building not found.");
      const result = await database.query(
        "SELECT floor_number,updated_at,version FROM floor_layouts WHERE building_id=$1 ORDER BY floor_number",
        [request.params.id],
      );
      response.json(
        result.rows.map((row) => ({
          number: row.floor_number,
          updatedAt: row.updated_at.toISOString(),
          version: row.version,
        })),
      );
    }),
  );

  app.get(
    "/api/buildings/:id/floors/:number",
    asyncRoute(async (request, response) => {
      const floor = floorNumberSchema.safeParse(request.params.number);
      if (!floor.success)
        throw new ApiError(400, "invalid_input", "Floor number is invalid.");
      const result = await database.query(
        "SELECT building_id,floor_number,layout,updated_at,version FROM floor_layouts WHERE building_id=$1 AND floor_number=$2",
        [request.params.id, floor.data],
      );
      if (!result.rowCount)
        throw new ApiError(404, "not_found", "No data available.");
      const row = result.rows[0];
      response.json({
        buildingId: row.building_id,
        number: row.floor_number,
        layout: parseJson<FloorLayout>(row.layout),
        updatedAt: row.updated_at.toISOString(),
        version: row.version,
      });
    }),
  );

  app.post(
    "/api/visitor-messages",
    messageLimit,
    upload.single("image"),
    asyncRoute(async (request, response) => {
      const parsed = visitorMessageSchema.safeParse(request.body);
      if (!parsed.success)
        throw new ApiError(
          400,
          "invalid_input",
          "Add a note and select a valid map location.",
        );
      let uploaded: Awaited<ReturnType<EvidenceStore["upload"]>> | null = null;
      try {
        if (request.file) uploaded = await evidence.upload(request.file.buffer);
        await database.query(
          `INSERT INTO visitor_messages(id,original_text,longitude,latitude,cloudinary_public_id,cloudinary_format,cloudinary_delivery_type)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            randomUUID(),
            parsed.data.text,
            parsed.data.longitude,
            parsed.data.latitude,
            uploaded?.publicId ?? null,
            uploaded?.format ?? null,
            uploaded?.deliveryType ?? null,
          ],
        );
      } catch (error) {
        if (uploaded)
          await evidence.remove(uploaded.publicId).catch(() => undefined);
        throw error;
      }
      response.status(201).json({ received: true });
    }),
  );

  app.post(
    "/api/editor/login",
    loginLimit,
    asyncRoute(async (request, response) => {
      const parsed = editorLoginSchema.safeParse(request.body);
      if (!parsed.success)
        throw new ApiError(
          400,
          "invalid_input",
          "Enter a valid editor email and password.",
        );
      const token = await auth.authenticate(
        parsed.data.email,
        parsed.data.password,
      );
      if (!token)
        throw new ApiError(
          401,
          "unauthorized",
          "Email or password is incorrect.",
        );
      response.json({ token, expiresInSeconds: 7200 });
    }),
  );

  const editor = express.Router();
  editor.use(
    (request, response, next) =>
      void auth.requireEditor(request, response, next),
  );
  editor.put(
    "/routes/:id",
    asyncRoute(async (request, response) => {
      const parsed = editorRouteUpdateSchema.safeParse(request.body);
      if (!parsed.success)
        throw new ApiError(
          400,
          "invalid_input",
          "Route note or block details are invalid.",
        );
      await inTransaction(database, async (client) => {
        const exists = await client.query(
          "SELECT 1 FROM route_features WHERE id=$1",
          [request.params.id],
        );
        if (!exists.rowCount)
          throw new ApiError(404, "not_found", "Route segment not found.");
        await client.query(
          `INSERT INTO route_annotations(route_feature_id,public_note,blocked,block_reason,expires_at)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(route_feature_id) DO UPDATE SET public_note=EXCLUDED.public_note,blocked=EXCLUDED.blocked,
        block_reason=EXCLUDED.block_reason,expires_at=EXCLUDED.expires_at,version=route_annotations.version+1,updated_at=now()`,
          [
            request.params.id,
            parsed.data.publicNote ?? null,
            parsed.data.blocked,
            parsed.data.blocked ? parsed.data.blockReason : null,
            parsed.data.blocked ? parsed.data.expiresAt : null,
          ],
        );
        await client.query(
          "UPDATE map_revision SET revision=revision+1,updated_at=now() WHERE singleton=true",
        );
      });
      response.json({ saved: true });
    }),
  );

  editor.put(
    "/buildings/:id/floors/:number",
    asyncRoute(async (request, response) => {
      const number = floorNumberSchema.safeParse(request.params.number);
      const layout = floorLayoutSchema.safeParse(request.body);
      if (!number.success || !layout.success)
        throw new ApiError(
          400,
          "invalid_input",
          "Floor layout is invalid or extends outside the canvas.",
        );
      const result = await database.query(
        `INSERT INTO floor_layouts(building_id,floor_number,layout,canvas_width,canvas_height)
      VALUES($1,$2,$3::jsonb,$4,$5) ON CONFLICT(building_id,floor_number) DO UPDATE SET layout=EXCLUDED.layout,
      canvas_width=EXCLUDED.canvas_width,canvas_height=EXCLUDED.canvas_height,version=floor_layouts.version+1,updated_at=now()
      RETURNING version,updated_at`,
        [
          request.params.id,
          number.data,
          JSON.stringify(layout.data),
          layout.data.canvasWidth,
          layout.data.canvasHeight,
        ],
      );
      response.json({
        saved: true,
        version: result.rows[0].version,
        updatedAt: result.rows[0].updated_at.toISOString(),
      });
    }),
  );

  editor.post(
    "/points",
    asyncRoute(async (request, response) => {
      const parsed = pointWriteSchema.safeParse(request.body);
      if (!parsed.success)
        throw new ApiError(
          400,
          "invalid_input",
          "Point name or location is invalid.",
        );
      const id = randomUUID();
      await database.query(
        "INSERT INTO public_points(id,name,note,longitude,latitude) VALUES($1,$2,$3,$4,$5)",
        [id, parsed.data.name, parsed.data.note, ...parsed.data.coordinates],
      );
      response.status(201).json({ id });
    }),
  );
  editor.patch(
    "/points/:id",
    asyncRoute(async (request, response) => {
      const parsed = pointWriteSchema.safeParse(request.body);
      if (!parsed.success)
        throw new ApiError(
          400,
          "invalid_input",
          "Point name or location is invalid.",
        );
      const result = await database.query(
        "UPDATE public_points SET name=$2,note=$3,longitude=$4,latitude=$5,updated_at=now() WHERE id=$1",
        [
          request.params.id,
          parsed.data.name,
          parsed.data.note,
          ...parsed.data.coordinates,
        ],
      );
      if (!result.rowCount)
        throw new ApiError(404, "not_found", "Point not found.");
      response.json({ saved: true });
    }),
  );
  editor.delete(
    "/points/:id",
    asyncRoute(async (request, response) => {
      const result = await database.query(
        "DELETE FROM public_points WHERE id=$1",
        [request.params.id],
      );
      if (!result.rowCount)
        throw new ApiError(404, "not_found", "Point not found.");
      response.status(204).end();
    }),
  );

  editor.get(
    "/messages",
    asyncRoute(async (request, response) => {
      const status =
        request.query.status === undefined
          ? null
          : messageStatusSchema.safeParse(request.query.status);
      if (status && !status.success)
        throw new ApiError(400, "invalid_input", "Message status is invalid.");
      const result = status
        ? await database.query(
            "SELECT * FROM visitor_messages WHERE status=$1 ORDER BY created_at DESC",
            [status.data],
          )
        : await database.query(
            "SELECT * FROM visitor_messages ORDER BY created_at DESC",
          );
      response.json(result.rows.map(messageRow));
    }),
  );
  editor.patch(
    "/messages/:id",
    asyncRoute(async (request, response) => {
      const parsed = messagePatchSchema.safeParse(request.body);
      if (!parsed.success)
        throw new ApiError(400, "invalid_input", "Message update is invalid.");
      const result = await database.query(
        `UPDATE visitor_messages SET status=COALESCE($2,status),editor_annotation=CASE WHEN $3 THEN $4 ELSE editor_annotation END,updated_at=now()
      WHERE id=$1 RETURNING *`,
        [
          request.params.id,
          parsed.data.status ?? null,
          Object.hasOwn(parsed.data, "editorAnnotation"),
          parsed.data.editorAnnotation ?? null,
        ],
      );
      if (!result.rowCount)
        throw new ApiError(404, "not_found", "Message not found.");
      response.json(messageRow(result.rows[0]));
    }),
  );
  editor.get(
    "/messages/:id/evidence",
    asyncRoute(async (request, response) => {
      const result = await database.query(
        "SELECT cloudinary_public_id,cloudinary_format,cloudinary_delivery_type FROM visitor_messages WHERE id=$1",
        [request.params.id],
      );
      if (!result.rowCount || !result.rows[0].cloudinary_public_id)
        throw new ApiError(404, "not_found", "Evidence not found.");
      const row = result.rows[0];
      response.json({
        url: evidence.signedUrl(
          row.cloudinary_public_id,
          row.cloudinary_format,
          row.cloudinary_delivery_type,
        ),
        expiresInSeconds: 300,
      });
    }),
  );
  editor.delete(
    "/messages/:id",
    asyncRoute(async (request, response) => {
      const deleted = await database.query(
        "DELETE FROM visitor_messages WHERE id=$1 RETURNING cloudinary_public_id",
        [request.params.id],
      );
      if (!deleted.rowCount)
        throw new ApiError(404, "not_found", "Message not found.");
      const publicId = deleted.rows[0].cloudinary_public_id as string | null;
      if (publicId) {
        try {
          await evidence.remove(publicId);
        } catch (error) {
          await database.query(
            "INSERT INTO media_cleanup_jobs(id,cloudinary_public_id,reason,last_error) VALUES($1,$2,$3,$4)",
            [
              randomUUID(),
              publicId,
              "message_deleted",
              error instanceof Error ? error.message.slice(0, 500) : "unknown",
            ],
          );
        }
      }
      response.status(204).end();
    }),
  );
  app.use("/api/editor", editor);

  app.use((_request, response) =>
    sendError(response, 404, "not_found", "Endpoint not found."),
  );
  app.use(errorHandler);
  return app;
}
