/**
 * Release step, run by the host before each deploy (compiled: node dist/bin/release.js).
 * Applies pending migrations, then loads the ⚠️ sample catalog if SEED_SAMPLE_DATA=true.
 * Both steps are idempotent, so running on every deploy is safe.
 */
import { loadConfig, loadDotEnv } from "../config.js";
import { seedSampleCatalog } from "../data/seed-sample.js";
import { createPgDatabase } from "../db/database.js";
import { applyMigrations } from "../db/migrate.js";
import { consoleLogger as logger } from "../logger.js";

loadDotEnv();
const config = loadConfig();
if (!config.databaseUrl) {
  logger.log("error", "release.no_database_url");
  process.exit(1);
}

const db = createPgDatabase(config.databaseUrl);
try {
  const applied = await applyMigrations(db);
  logger.log("info", "release.migrations", { applied });
  if (process.env.SEED_SAMPLE_DATA?.trim().toLowerCase() === "true") {
    if (config.nodeEnv === "production") throw new Error("SEED_SAMPLE_DATA=true is not allowed with NODE_ENV=production");
    const ids = await seedSampleCatalog(db);
    logger.log("info", "release.sample_data_seeded", { products: ids.size });
  }
} finally {
  await db.close();
}
