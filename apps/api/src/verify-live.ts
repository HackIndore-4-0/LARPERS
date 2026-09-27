import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { readBundledOsm } from "./osm/import.js";
import { parseOsmImportModel } from "./osm/parse.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);

try {
  const source = parseOsmImportModel(await readBundledOsm());
  const result = await database.query(`SELECT
    (SELECT count(*)::integer FROM buildings) AS buildings,
    (SELECT count(*)::integer FROM route_features) AS routes,
    (SELECT count(*)::integer FROM route_annotations) AS annotations,
    (SELECT count(*)::integer FROM floor_layouts) AS floors,
    (SELECT count(*)::integer FROM public_points) AS points,
    (SELECT count(*)::integer FROM visitor_messages) AS messages,
    (SELECT revision::integer FROM map_revision WHERE singleton=true) AS revision,
    (SELECT count(*)::integer FROM buildings WHERE source_osm_id IS NULL) AS buildings_without_source,
    (SELECT count(*)::integer FROM route_features WHERE source_type='osm' AND source_osm_id IS NULL) AS osm_routes_without_source`);
  const row = result.rows[0];
  console.log(
    JSON.stringify({
      source: {
        buildings: source.buildings.length,
        routes: source.routes.length,
      },
      database: {
        buildings: row.buildings,
        routes: row.routes,
        annotations: row.annotations,
        floors: row.floors,
        points: row.points,
        messages: row.messages,
        revision: row.revision,
      },
      stableSourceMapping:
        row.buildings_without_source === 0 &&
        row.osm_routes_without_source === 0,
    }),
  );
} finally {
  await database.end();
}
