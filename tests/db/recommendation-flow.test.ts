import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SAMPLE_EXCHANGE_RATES, SAMPLE_PRODUCTS, SAMPLE_REFERENCE_DATE } from "../../src/data/sample-products.js";
import { seedSampleCatalog } from "../../src/data/seed-sample.js";
import type { Database } from "../../src/db/database.js";
import { saveRecommendationSession } from "../../src/db/recommendation-repository.js";
import { parseGiftRequest } from "../../src/domain/types.js";
import { ENGINE_VERSION, recommend } from "../../src/recommendation/index.js";
import { recommendFromCatalog } from "../../src/services/recommendation-service.js";
import { createTestDatabase, resetTables } from "../db-helpers.js";

let db: Database;

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);
afterAll(async () => db?.close());
beforeEach(async () => resetTables(db));

const coffeeRequest = parseGiftRequest({
  recipient: "colleague",
  occasion: "housewarming",
  budget: { max: 250, currency: "ILS" },
  avoid: ["alcohol"],
});

describe("seedSampleCatalog", () => {
  it("loads every sample product and is idempotent", async () => {
    const first = await seedSampleCatalog(db);
    const second = await seedSampleCatalog(db);
    expect(first.size).toBe(SAMPLE_PRODUCTS.length);
    expect([...second.values()]).toEqual([...first.values()]);
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.products");
    expect(rows[0]!.n).toBe(SAMPLE_PRODUCTS.length);
  });
});

describe("recommendFromCatalog", () => {
  it("gives the same recommendations from the database as from memory", async () => {
    const dbIds = await seedSampleCatalog(db);
    const options = { allowSampleProducts: true };

    const fromDb = await recommendFromCatalog(db, {
      request: coffeeRequest,
      exchangeRates: SAMPLE_EXCHANGE_RATES,
      now: SAMPLE_REFERENCE_DATE,
      options,
    });
    const inMemory = recommend({
      products: SAMPLE_PRODUCTS,
      request: coffeeRequest,
      exchangeRates: SAMPLE_EXCHANGE_RATES,
      now: SAMPLE_REFERENCE_DATE,
      options,
    });

    expect(fromDb.invalidProducts).toEqual([]);
    expect(inMemory.recommendations.length).toBeGreaterThan(0);
    const summarize = (r: typeof inMemory) =>
      r.recommendations.map((x) => ({ name: x.product.name, score: x.score, price: x.priceInBudgetCurrency }));
    expect(summarize(fromDb.result)).toEqual(summarize(inMemory));
    // Database results reference real row ids, not the sample ids.
    expect(fromDb.result.recommendations.map((r) => r.product.id)).toEqual(
      inMemory.recommendations.map((r) => dbIds.get(r.product.id)),
    );
  });

  it("persists the session, its stats and an exact snapshot of each item shown", async () => {
    await seedSampleCatalog(db);
    const { sessionId, itemIds, result } = await recommendFromCatalog(db, {
      request: coffeeRequest,
      exchangeRates: SAMPLE_EXCHANGE_RATES,
      now: SAMPLE_REFERENCE_DATE,
      options: { allowSampleProducts: true },
    });

    const session = (
      await db.query<Record<string, unknown>>("select * from public.recommendation_sessions where id = $1", [sessionId])
    ).rows[0]!;
    expect(session).toMatchObject({
      recipient: "colleague",
      occasion: "housewarming",
      budget_currency: "ILS",
      avoid: ["alcohol"],
      delivery_country: "IL",
      allow_international_shipping: true,
      engine_version: ENGINE_VERSION,
      evaluated_count: SAMPLE_PRODUCTS.length,
      excluded_count: result.excluded.length,
      below_threshold_count: result.belowThreshold.length,
      result_count: result.recommendations.length,
    });
    expect(Number(session.budget_max)).toBe(250);
    expect(session.engine_options).toMatchObject({ allowSampleProducts: true, maxResults: 5 });
    expect(session.exclusion_stats).toMatchObject({ matches_avoid_list: 1 });

    const items = (
      await db.query<{ id: string; rank: number; product_id: string; shown_price_amount: string; warnings: string[] }>(
        "select id, rank, product_id, shown_price_amount::text, warnings from public.recommendation_items where session_id = $1 order by rank",
        [sessionId],
      )
    ).rows;
    expect(items.map((i) => i.id)).toEqual(itemIds);
    expect(items.map((i) => i.product_id)).toEqual(result.recommendations.map((r) => r.product.id));
    expect(items.map((i) => Number(i.shown_price_amount))).toEqual(
      result.recommendations.map((r) => r.priceInBudgetCurrency.amount),
    );
    expect(items.every((i) => i.warnings.includes("sample_data"))).toBe(true);
  });

  it("never serves sample data by default — and still records the empty session", async () => {
    await seedSampleCatalog(db);
    const { result, sessionId, itemIds } = await recommendFromCatalog(db, {
      request: coffeeRequest,
      exchangeRates: SAMPLE_EXCHANGE_RATES,
      now: SAMPLE_REFERENCE_DATE,
    });
    expect(result.recommendations).toEqual([]);
    expect(result.evaluatedCount).toBe(0);
    expect(itemIds).toEqual([]);
    const { rows } = await db.query<{ result_count: number }>(
      "select result_count from public.recommendation_sessions where id = $1",
      [sessionId],
    );
    expect(rows[0]!.result_count).toBe(0);
  });

  it("saves atomically — a failing item rolls back the whole session", async () => {
    await seedSampleCatalog(db);
    const result = recommend({
      products: SAMPLE_PRODUCTS, // sample ids are not database ids → item insert fails
      request: coffeeRequest,
      exchangeRates: SAMPLE_EXCHANGE_RATES,
      now: SAMPLE_REFERENCE_DATE,
      options: { allowSampleProducts: true },
    });
    await expect(
      saveRecommendationSession(db, { request: coffeeRequest, result, exchangeRates: SAMPLE_EXCHANGE_RATES }),
    ).rejects.toThrow();
    const { rows } = await db.query("select 1 from public.recommendation_sessions");
    expect(rows).toHaveLength(0);
  });
});
