import { createServer } from "node:http";
import { createApp } from "./app.js";
import { createEditorAuth } from "./auth.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { createEvidenceStore } from "./media.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const auth = await createEditorAuth(config);
const evidence = createEvidenceStore(config);
const app = createApp({
  database,
  auth,
  evidence,
  webOrigin: config.WEB_ORIGIN,
});
const server = createServer(app);

server.listen(config.PORT, "0.0.0.0", () =>
  console.log(`Campus Access API listening on port ${config.PORT}`),
);

async function shutdown(): Promise<void> {
  server.close();
  await database.end();
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
