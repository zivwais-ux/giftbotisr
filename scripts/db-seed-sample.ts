/**
 * Loads the ⚠️ fictional sample catalog into DATABASE_URL. For development only.
 * Usage: npm run db:seed-sample
 */
import { loadConfig, loadDotEnv } from "../src/config.js";
import { seedSampleCatalog } from "../src/data/seed-sample.js";
import { createPgDatabase } from "../src/db/database.js";

loadDotEnv();
const { databaseUrl, nodeEnv } = loadConfig();
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Add it to .env (see .env.example).");
  process.exit(1);
}
if (nodeEnv === "production") {
  console.error("Refusing to seed sample data with NODE_ENV=production.");
  process.exit(1);
}

const db = createPgDatabase(databaseUrl);
try {
  const ids = await seedSampleCatalog(db);
  console.log(`Seeded ${ids.size} sample products (marked is_sample — hidden from real users).`);
} finally {
  await db.close();
}
