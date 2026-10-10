import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCatalogManifest } from "../../src/catalog/manifest.js";
import { silentLogger } from "../../src/logger.js";
import { createTestDatabase } from "../db-helpers.js";

const store = {
  slug: "t-store", name: "T", country: "IL", currency: "ILS", websiteUrl: "https://example.co.il", dataSource: "manual",
  terms: { approvalStatus: "approved", allowsMessagingLinks: true, reviewedAt: "2026-10-10" },
};
const csv = (rows: string[]) => ["id,title,price,link", ...rows].join("\n");

async function setup(csvText: string) {
  const dir = await mkdtemp(join(tmpdir(), "manifest-"));
  await mkdir(join(dir, "stores"));
  await writeFile(join(dir, "stores", "t.json"), JSON.stringify(store));
  await writeFile(join(dir, "p.csv"), csvText);
  await writeFile(join(dir, "imports.json"), JSON.stringify([{ store: "stores/t.json", file: "p.csv" }]));
  return join(dir, "imports.json");
}

describe("catalog manifest", () => {
  it("returns nothing when there is no manifest", async () => {
    const db = await createTestDatabase();
    expect(await runCatalogManifest(db, "/nonexistent/imports.json", silentLogger)).toEqual([]);
    await db.close();
  });

  it("imports, then syncs: a product removed from the file is deactivated", async () => {
    const db = await createTestDatabase();
    const path = await setup(csv(["a,מוצר א,10,https://example.co.il/a", "b,מוצר ב,20,https://example.co.il/b"]));
    expect((await runCatalogManifest(db, path, silentLogger))[0]).toMatchObject({ valid: 2, created: 2 });
    const path2 = await setup(csv(["a,מוצר א,10,https://example.co.il/a"]));
    expect((await runCatalogManifest(db, path2, silentLogger))[0]).toMatchObject({ updated: 1, deactivated: 1 });
    await db.close();
  });

  it("refuses a file with no valid rows instead of emptying the store", async () => {
    const db = await createTestDatabase();
    const path = await setup(csv(["a,מוצר,,https://example.co.il/a"]));
    await expect(runCatalogManifest(db, path, silentLogger)).rejects.toThrow(/no valid rows/);
    await db.close();
  });
});
