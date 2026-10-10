import { describe, expect, it } from "vitest";
import { runCatalogManifest } from "../../src/catalog/manifest.js";
import { silentLogger } from "../../src/logger.js";
import { createTestDatabase } from "../db-helpers.js";

/** The catalog committed in the repository must always import cleanly. */
describe("committed catalog", () => {
  it("imports without invalid rows", async () => {
    const db = await createTestDatabase();
    const results = await runCatalogManifest(db, "catalog/imports.json", silentLogger);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r.invalid).toBe(0);
    await db.close();
  });
});
