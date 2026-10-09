import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseDelimited } from "../../src/catalog/feed-parsers.js";
import { formatReport, importCatalog } from "../../src/catalog/import.js";
import { loadActiveProducts } from "../../src/db/catalog-repository.js";
import type { Database } from "../../src/db/database.js";
import { parseGiftRequest } from "../../src/domain/types.js";
import { recommendFromCatalog } from "../../src/services/recommendation-service.js";
import { makeStore } from "../catalog/helpers.js";
import { createTestDatabase, resetTables } from "../db-helpers.js";

let db: Database;
beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);
afterAll(async () => db?.close());
beforeEach(async () => resetTables(db));

const NOW = new Date("2026-10-09T10:00:00Z");
const CSV = `id,title,price,link,image_link,availability,product_type
A1,ספל לאוהבי קפה,89 ILS,https://shop.test/a1,https://shop.test/a1.jpg,in stock,בית > ספלים
A2,סט סכין שף,249 ILS,https://shop.test/a2,https://shop.test/a2.jpg,in stock,מטבח
A3,מוצר בלי מחיר,,https://shop.test/a3,,in stock,כללי
A1,כפילות,10 ILS,https://shop.test/dup,,in stock,כללי
`;
const rows = parseDelimited(CSV);
const count = async (sql: string) => Number((await db.query<{ n: string }>(sql)).rows[0]!.n);

describe("importCatalog", () => {
  it("dry run validates and reports without writing anything", async () => {
    const report = await importCatalog(db, makeStore(), rows, { now: NOW });
    expect(report).toMatchObject({ applied: false, totalRows: 4, valid: 2, created: 2, updated: 0, autoTagged: 2 });
    expect(report.invalid).toEqual([
      { row: 3, externalId: "A3", errors: ['price: missing or unreadable ("")'] },
      { row: 4, externalId: "A1", errors: ['duplicate id "A1" (first seen in row 1)'] },
    ]);
    expect(await count("select count(*) as n from public.products")).toBe(0);
    expect(await count("select count(*) as n from public.stores")).toBe(0);
  });

  it("--apply imports the store and valid products", async () => {
    const report = await importCatalog(db, makeStore(), rows, { apply: true, now: NOW });
    expect(report).toMatchObject({ applied: true, valid: 2, created: 2 });
    const { products } = await loadActiveProducts(db);
    expect(products.map((p) => p.name).sort()).toEqual(["סט סכין שף", "ספל לאוהבי קפה"]);
  });

  it("re-importing the same file updates instead of duplicating", async () => {
    await importCatalog(db, makeStore(), rows, { apply: true, now: NOW });
    const changed = parseDelimited(CSV.replace("89 ILS", "79 ILS"));
    const report = await importCatalog(db, makeStore(), changed, { apply: true, now: NOW });
    expect(report).toMatchObject({ created: 0, updated: 2 });
    expect(await count("select count(*) as n from public.products")).toBe(2);
    const { products } = await loadActiveProducts(db);
    expect(products.find((p) => p.name === "ספל לאוהבי קפה")?.price.amount).toBe(79);
  });

  it("--sync hides products missing from the new file (and dry run only counts them)", async () => {
    await importCatalog(db, makeStore(), rows, { apply: true, now: NOW });
    const onlyA2 = parseDelimited(CSV.split("\n").filter((l) => !l.startsWith("A1")).join("\n"));
    const dry = await importCatalog(db, makeStore(), onlyA2, { sync: true, now: NOW });
    expect(dry.deactivated).toBe(1);
    expect((await loadActiveProducts(db)).products).toHaveLength(2);

    await importCatalog(db, makeStore(), onlyA2, { apply: true, sync: true, now: NOW });
    expect((await loadActiveProducts(db)).products.map((p) => p.name)).toEqual(["סט סכין שף"]);
  });

  it("without --sync, products missing from the file stay active", async () => {
    await importCatalog(db, makeStore(), rows, { apply: true, now: NOW });
    await importCatalog(db, makeStore(), rows.slice(1, 2), { apply: true, now: NOW });
    expect((await loadActiveProducts(db)).products).toHaveLength(2);
  });

  it("stores products of an unapproved store but never shows them", async () => {
    const pending = makeStore({ terms: { approvalStatus: "pending" } });
    const report = await importCatalog(db, pending, rows, { apply: true, now: NOW });
    expect(report.storeApproved).toBe(false);
    expect(formatReport(report)).toContain("NOT APPROVED");
    expect(await count("select count(*) as n from public.products")).toBe(2);
    expect((await loadActiveProducts(db)).products).toEqual([]);
  });

  it("imported products reach real recommendations, with affiliate links", async () => {
    const store = makeStore({ affiliateLinkTemplate: "https://track.test/c?url={url}" });
    await importCatalog(db, store, rows, { apply: true, now: NOW });
    const { result } = await recommendFromCatalog(db, {
      request: parseGiftRequest({ recipient: "friend", occasion: "birthday", budget: { max: 100, currency: "ILS" }, interests: ["coffee"] }),
      exchangeRates: { toIls: {}, asOf: NOW },
      now: NOW,
    });
    expect(result.recommendations.map((r) => r.product.name)).toEqual(["ספל לאוהבי קפה"]);
    expect(result.recommendations[0]!.product.affiliateUrl).toBe("https://track.test/c?url=https%3A%2F%2Fshop.test%2Fa1");
    expect(result.recommendations[0]!.warnings).not.toContain("sample_data");
  });

  it("formats a readable report", async () => {
    const text = formatReport(await importCatalog(db, makeStore(), rows, { now: NOW }));
    expect(text).toContain("DRY RUN");
    expect(text).toContain("Rows: 4 | valid: 2 | invalid: 2");
    expect(text).toContain('row 3 (id A3): price: missing or unreadable ("")');
  });
});
