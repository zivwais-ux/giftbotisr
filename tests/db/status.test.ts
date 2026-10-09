import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedSampleCatalog } from "../../src/data/seed-sample.js";
import { SAMPLE_PRODUCTS } from "../../src/data/sample-products.js";
import type { Database } from "../../src/db/database.js";
import { getDatabaseStatus } from "../../src/db/status.js";
import { createTestDatabase, resetTables } from "../db-helpers.js";

let db: Database;
beforeAll(async () => {
  db = await createTestDatabase();
  await resetTables(db);
}, 60_000);
afterAll(async () => db?.close());

describe("getDatabaseStatus", () => {
  it("reports applied migrations and catalog counts", async () => {
    expect(await getDatabaseStatus(db)).toEqual({
      migrations: ["20261009120000", "20261010090000"],
      activeProducts: 0,
      activeSampleProducts: 0,
      approvedStores: 0,
    });
    await seedSampleCatalog(db);
    expect(await getDatabaseStatus(db)).toMatchObject({
      activeProducts: SAMPLE_PRODUCTS.length,
      activeSampleProducts: SAMPLE_PRODUCTS.length,
      approvedStores: 3,
    });
  });
});
