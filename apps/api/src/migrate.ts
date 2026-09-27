import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createDatabase, inTransaction } from "./db.js";

export async function runMigrations(
  connectionString: string,
): Promise<string[]> {
  const database = createDatabase(connectionString);
  const migrationDirectory = fileURLToPath(new URL("../db", import.meta.url));
  try {
    await database.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = (await readdir(migrationDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const applied: string[] = [];
    for (const name of files) {
      const existing = await database.query(
        "SELECT 1 FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (existing.rowCount) continue;
      const sql = await readFile(
        new URL(`../db/${name}`, import.meta.url),
        "utf8",
      );
      await inTransaction(database, async (client) => {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [
          name,
        ]);
      });
      applied.push(name);
    }
    return applied;
  } finally {
    await database.end();
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()
) {
  runMigrations(loadConfig().DATABASE_URL)
    .then((applied) =>
      console.log(
        applied.length
          ? `Applied: ${applied.join(", ")}`
          : "Database already current.",
      ),
    )
    .catch(() => {
      console.error(
        "Migration failed. Check the database URL and permissions.",
      );
      process.exitCode = 1;
    });
}
