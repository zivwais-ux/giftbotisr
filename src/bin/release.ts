/**
 * Release step, run by the host before each deploy (compiled: node dist/bin/release.js).
 * Applies pending migrations, imports the catalog listed in catalog/imports.json, then loads the ⚠️ sample catalog if SEED_SAMPLE_DATA=true.
 * Both steps are idempotent, so running on every deploy is safe.
 *
 * It deliberately reads only what it needs (DATABASE_URL, NODE_ENV): a mistake in an unrelated
 * setting such as WhatsApp must not block database migrations. The server itself validates the
 * full configuration at startup and reports exactly which value is wrong.
 */
import { runCatalogManifest } from "../catalog/manifest.js";
import { loadDotEnv } from "../config.js";
import { seedSampleCatalog } from "../data/seed-sample.js";
import { createPgDatabase } from "../db/database.js";
import { applyMigrations } from "../db/migrate.js";
import { consoleLogger as logger } from "../logger.js";

loadDotEnv();
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl || !/^postgres(ql)?:\/\//.test(databaseUrl)) {
  logger.log("error", "release.invalid_database_url", { hint: "DATABASE_URL is missing or not a postgres:// URL" });
  process.exit(1);
}

const db = createPgDatabase(databaseUrl);
try {
  const applied = await applyMigrations(db);
  logger.log("info", "release.migrations", { applied });
  await runCatalogManifest(db, "catalog/imports.json", logger);
  if (process.env.SEED_SAMPLE_DATA?.trim().toLowerCase() === "true") {
    if (process.env.NODE_ENV === "production") throw new Error("SEED_SAMPLE_DATA=true is not allowed with NODE_ENV=production");
    const ids = await seedSampleCatalog(db);
    logger.log("info", "release.sample_data_seeded", { products: ids.size });
  }
} catch (err) {
  logger.log("error", "release.failed", { error: (err as Error).message });
  process.exitCode = 1;
} finally {
  await db.close();
}
