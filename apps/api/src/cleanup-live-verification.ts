import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";

const database = createDatabase(loadConfig().DATABASE_URL);
try {
  const annotation = await database.query(
    `DELETE FROM route_annotations
     WHERE public_note LIKE 'Local verification %'
       AND block_reason='Temporary localhost verification block'`,
  );
  const points = await database.query(
    `DELETE FROM public_points
     WHERE name LIKE 'Verification point %' AND note LIKE 'Local verification %'`,
  );
  const floors = await database.query(
    `DELETE FROM floor_layouts
     WHERE floor_number=199 AND layout->'blocks' @> '[{"id":"live-verification-block"}]'::jsonb`,
  );
  const messages = await database.query(
    `DELETE FROM visitor_messages
     WHERE original_text LIKE 'Local verification %' AND cloudinary_public_id IS NULL`,
  );
  console.log(
    JSON.stringify({
      removedTemporaryAnnotations: annotation.rowCount,
      removedTemporaryPoints: points.rowCount,
      removedTemporaryFloors: floors.rowCount,
      removedTextOnlyMessages: messages.rowCount,
    }),
  );
} finally {
  await database.end();
}
