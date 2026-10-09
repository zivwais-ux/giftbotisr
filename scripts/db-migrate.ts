/** Applies pending SQL migrations to DATABASE_URL. Usage: npm run db:migrate */
import { loadConfig, loadDotEnv } from "../src/config.js";
import { createPgDatabase } from "../src/db/database.js";
import { applyMigrations } from "../src/db/migrate.js";

loadDotEnv();
const { databaseUrl } = loadConfig();
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Add it to .env (see .env.example).");
  process.exit(1);
}

const db = createPgDatabase(databaseUrl);
try {
  const applied = await applyMigrations(db);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
} finally {
  await db.close();
}
