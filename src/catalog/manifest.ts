import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { Database } from "../db/database.js";
import type { Logger } from "../logger.js";
import { parseFeed } from "./feed-parsers.js";
import { importCatalog } from "./import.js";
import { loadStoreConfig } from "./store-config.js";

/**
 * catalog/imports.json lists which store files to load on each deploy:
 *   [{ "store": "stores/temu.json", "file": "temu-products.csv", "sync": true }]
 * Paths are relative to the manifest's folder. The files live in version control, so the catalog
 * the bot serves is always the one reviewed in the repository.
 */
const ManifestSchema = z.array(
  z.object({ store: z.string().min(1), file: z.string().min(1), sync: z.boolean().default(true) }),
);

export interface ManifestResult {
  store: string;
  valid: number;
  invalid: number;
  created: number;
  updated: number;
  deactivated: number;
}

/** Imports every entry. A file with no valid rows is an error: it would otherwise silently empty a store when synced. */
export async function runCatalogManifest(db: Database, manifestPath: string, logger: Logger): Promise<ManifestResult[]> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const entries = ManifestSchema.parse(JSON.parse(raw));
  const base = dirname(resolve(manifestPath));
  const results: ManifestResult[] = [];
  for (const entry of entries) {
    const store = await loadStoreConfig(resolve(base, entry.store));
    const filePath = resolve(base, entry.file);
    const rows = parseFeed(filePath, await readFile(filePath, "utf8"));
    const report = await importCatalog(db, store, rows, { apply: true, sync: entry.sync });
    if (report.valid === 0) throw new Error(`catalog import for "${store.slug}" has no valid rows; refusing to continue`);
    const result = {
      store: store.slug,
      valid: report.valid,
      invalid: report.invalid.length,
      created: report.created,
      updated: report.updated,
      deactivated: report.deactivated,
    };
    logger.log(report.invalid.length > 0 ? "warn" : "info", "release.catalog_imported", { ...result, approved: report.storeApproved });
    results.push(result);
  }
  return results;
}
