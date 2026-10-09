/**
 * Imports a store's product file into the database.
 *
 *   npm run catalog:import -- --store catalog/stores/<slug>.json --file products.csv [--apply] [--sync]
 *
 * Without --apply it is a dry run: it validates the file and prints a report, writing nothing.
 * --sync treats the file as the store's full catalog and deactivates products missing from it.
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { formatReport, importCatalog } from "../src/catalog/import.js";
import { parseFeed } from "../src/catalog/feed-parsers.js";
import { loadStoreConfig } from "../src/catalog/store-config.js";
import { loadConfig, loadDotEnv } from "../src/config.js";
import { createPgDatabase } from "../src/db/database.js";

const { values } = parseArgs({
  options: {
    store: { type: "string" },
    file: { type: "string" },
    apply: { type: "boolean", default: false },
    sync: { type: "boolean", default: false },
  },
});
if (!values.store || !values.file) {
  console.error("Usage: npm run catalog:import -- --store <store.json> --file <products.csv|feed.xml> [--apply] [--sync]");
  process.exit(1);
}

loadDotEnv();
const { databaseUrl } = loadConfig();
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Add it to .env (see .env.example).");
  process.exit(1);
}

const store = await loadStoreConfig(values.store);
const rows = parseFeed(values.file, await readFile(values.file, "utf8"));
const db = createPgDatabase(databaseUrl);
try {
  const report = await importCatalog(db, store, rows, { apply: values.apply, sync: values.sync });
  console.log(formatReport(report));
  if (report.valid === 0) process.exitCode = 1;
} finally {
  await db.close();
}
