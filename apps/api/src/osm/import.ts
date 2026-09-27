import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { loadConfig } from "../config.js";
import { createDatabase, inTransaction } from "../db.js";
import { parseOsmImportModel } from "./parse.js";

export async function readBundledOsm(): Promise<string> {
  return readFile(new URL("../../data/campus.osm", import.meta.url), "utf8");
}

export async function importOsm(
  client: Pick<PoolClient, "query">,
  xml: string,
): Promise<{ buildings: number; routes: number }> {
  const model = parseOsmImportModel(xml);
  for (const building of model.buildings) {
    await client.query(
      `INSERT INTO buildings(id,source_osm_id,name,search_label,footprint,mapped_level_count,approach,approach_approximate,ground_floor_lift_available)
       VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9)
       ON CONFLICT(source_osm_id) DO UPDATE SET name=EXCLUDED.name,search_label=EXCLUDED.search_label,
         footprint=EXCLUDED.footprint,mapped_level_count=EXCLUDED.mapped_level_count,approach=EXCLUDED.approach,
         approach_approximate=EXCLUDED.approach_approximate,ground_floor_lift_available=EXCLUDED.ground_floor_lift_available,updated_at=now()`,
      [
        building.id,
        building.sourceOsmId,
        building.name,
        building.name.toLowerCase(),
        JSON.stringify(building.footprint),
        building.levels,
        JSON.stringify(building.approach),
        building.approachApproximate,
        building.groundFloorLiftAvailable,
      ],
    );
  }
  for (const route of model.routes) {
    await client.query(
      `INSERT INTO route_features(id,source_osm_id,source_type,ordered_node_ids,geometry,classification,level_key,surface,slope_percent,width_meters,stairs,wheelchair_access,confidence,osm_tags)
       VALUES($1,$2,'osm',$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,'osm_tag',$12::jsonb)
       ON CONFLICT(source_osm_id) DO UPDATE SET ordered_node_ids=EXCLUDED.ordered_node_ids,geometry=EXCLUDED.geometry,
         classification=EXCLUDED.classification,level_key=EXCLUDED.level_key,surface=EXCLUDED.surface,slope_percent=EXCLUDED.slope_percent,
         width_meters=EXCLUDED.width_meters,stairs=EXCLUDED.stairs,wheelchair_access=EXCLUDED.wheelchair_access,
         osm_tags=EXCLUDED.osm_tags,updated_at=now()`,
      [
        route.id,
        route.sourceOsmId,
        JSON.stringify(route.orderedNodeIds),
        JSON.stringify(route.geometry),
        route.classification,
        route.levelKey,
        route.surface,
        route.slopePercent,
        route.widthMeters,
        route.stairs,
        route.wheelchairAccess,
        JSON.stringify(route.osmTags),
      ],
    );
  }
  return { buildings: model.buildings.length, routes: model.routes.length };
}

export async function importBundledOsm(
  connectionString: string,
): Promise<{ buildings: number; routes: number }> {
  const database = createDatabase(connectionString);
  const xml = await readBundledOsm();
  try {
    return await inTransaction(database, (client) => importOsm(client, xml));
  } finally {
    await database.end();
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()
) {
  importBundledOsm(loadConfig().DATABASE_URL)
    .then((counts) =>
      console.log(
        `Imported ${counts.buildings} buildings and ${counts.routes} route features.`,
      ),
    )
    .catch(() => {
      console.error(
        "OSM import failed. Check the database URL and migration state.",
      );
      process.exitCode = 1;
    });
}
