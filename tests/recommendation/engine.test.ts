import { describe, expect, it } from "vitest";
import { SAMPLE_EXCHANGE_RATES, SAMPLE_PRODUCTS, SAMPLE_REFERENCE_DATE } from "../../src/data/sample-products.js";
import type { GiftRequest, Product } from "../../src/domain/types.js";
import { ENGINE_VERSION, recommend, type EngineOptions } from "../../src/recommendation/index.js";
import { makeProduct, makeRequest, NOW, RATES } from "../helpers.js";

function run(products: Product[], request: GiftRequest = makeRequest(), options?: Partial<EngineOptions>) {
  return recommend({ products, request, exchangeRates: RATES, now: NOW, options });
}

const ids = (result: ReturnType<typeof run>) => result.recommendations.map((r) => r.product.id);

describe("recommend", () => {
  it("returns an empty result for an empty catalog", () => {
    expect(run([])).toMatchObject({ recommendations: [], excluded: [], belowThreshold: [], evaluatedCount: 0 });
  });

  it("returns at most maxResults, ranked by score", () => {
    const products = Array.from({ length: 8 }, (_, i) =>
      makeProduct({ id: `p${i}`, categories: [`cat${i}`], price: { amount: 50 + i * 30, currency: "ILS" } }),
    );
    const result = run(products);
    expect(result.recommendations).toHaveLength(5);
    expect(result.recommendations.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    const scores = result.recommendations.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("does not pad the list with irrelevant products", () => {
    const relevant = makeProduct({ id: "coffee" });
    const unrelated = makeProduct({ id: "hammock", interests: ["camping"], categories: ["outdoor"] });
    const result = run([relevant, unrelated]);
    expect(ids(result)).toEqual(["coffee"]);
    expect(result.belowThreshold).toEqual([{ productId: "hammock", score: 0.7, reason: "no_interest_match" }]);
  });

  it("allows a 'general ideas' fallback when interest matching is turned off", () => {
    const unrelated = makeProduct({ id: "hammock", interests: ["camping"], categories: ["outdoor"] });
    expect(ids(run([unrelated], makeRequest(), { requireInterestMatch: false }))).toEqual(["hammock"]);
  });

  it("drops products below minScore", () => {
    const weak = makeProduct({
      id: "weak",
      occasions: ["any"],
      recipients: ["any"],
      availability: "unknown",
      imageUrl: undefined,
      shipping: undefined,
      price: { amount: 10, currency: "ILS" },
    });
    const result = run([weak], makeRequest({ interests: [] }));
    expect(result.recommendations).toEqual([]);
    expect(result.belowThreshold[0]).toMatchObject({ productId: "weak", reason: "below_min_score" });
  });

  it("reports hard-filter exclusions with reasons", () => {
    const result = run([makeProduct({ id: "gone", availability: "out_of_stock" })]);
    expect(result.excluded).toEqual([{ productId: "gone", reasons: ["out_of_stock"] }]);
    expect(result.evaluatedCount).toBe(1);
  });

  it("never lets affiliate commission influence score or order", () => {
    const a = makeProduct({ id: "a", affiliateCommissionRate: 0.01 });
    const b = makeProduct({ id: "b", affiliateCommissionRate: 0.5 });
    const first = run([b, a]);
    const swapped = run([
      { ...a, affiliateCommissionRate: 0.5 },
      { ...b, affiliateCommissionRate: 0.01 },
    ]);
    expect(ids(first)).toEqual(["a", "b"]); // tie → broken by id, not commission
    expect(ids(swapped)).toEqual(["a", "b"]);
    expect(first.recommendations.map((r) => r.score)).toEqual(swapped.recommendations.map((r) => r.score));
  });

  it("breaks score ties by lower price, then id — regardless of input order", () => {
    const cheap = makeProduct({ id: "z-cheap", price: { amount: 200, currency: "ILS" } });
    const pricey = makeProduct({ id: "a-pricey", price: { amount: 250, currency: "ILS" } });
    expect(ids(run([pricey, cheap]))).toEqual(["z-cheap", "a-pricey"]);
    expect(ids(run([cheap, pricey]))).toEqual(["z-cheap", "a-pricey"]);
  });

  it("limits repeats of the same primary category when alternatives exist", () => {
    const sameCategory = ["k1", "k2", "k3", "k4"].map((id) => makeProduct({ id, categories: ["kitchen"] }));
    const other = makeProduct({ id: "other", categories: ["books"], imageUrl: undefined }); // slightly lower score
    const result = run([...sameCategory, other], makeRequest(), { maxResults: 3 });
    expect(ids(result)).toEqual(["k1", "k2", "other"]);
  });

  it("fills with same-category items when there are no alternatives", () => {
    const sameCategory = ["k1", "k2", "k3", "k4"].map((id) => makeProduct({ id, categories: ["kitchen"] }));
    expect(ids(run(sameCategory, makeRequest(), { maxResults: 3 }))).toEqual(["k1", "k2", "k3"]);
  });

  it("reports price in the budget currency and attaches honest warnings", () => {
    const product = makeProduct({
      id: "intl",
      price: { amount: 80, currency: "USD" },
      storeCountry: "US",
      shipping: { shipsTo: ["IL"] },
      availability: "unknown",
      imageUrl: undefined,
      lastVerifiedAt: new Date(NOW.getTime() - 10 * 86_400_000),
    });
    const [rec] = run([product], makeRequest(), { minScore: 0 }).recommendations;
    expect(rec?.priceInBudgetCurrency).toEqual({ amount: 320, currency: "ILS" });
    expect(rec?.warnings).toEqual([
      "availability_unknown",
      "price_not_recently_verified",
      "price_converted",
      "over_budget",
      "international_shipping",
      "delivery_time_unknown",
      "no_image",
    ]);
  });

  it("does not mutate the input catalog", () => {
    const products = [makeProduct({ id: "b" }), makeProduct({ id: "a" })];
    const snapshot = structuredClone(products);
    run(products);
    expect(products).toEqual(snapshot);
  });

  it("reports the engine version and the resolved options it used", () => {
    const result = run([], makeRequest(), { maxResults: 3 });
    expect(result.engineVersion).toBe(ENGINE_VERSION);
    expect(result.optionsUsed).toMatchObject({ maxResults: 3, minScore: 0.6, allowSampleProducts: false });
  });

  it("rejects invalid options", () => {
    expect(() => run([], makeRequest(), { maxResults: 0 })).toThrow(/maxResults/);
    expect(() => run([], makeRequest(), { budgetTolerance: 1 })).toThrow(/budgetTolerance/);
    expect(() =>
      run([], makeRequest(), {
        weights: { interests: 0.5, occasionAndRecipient: 0.5, budget: 0.5, delivery: 0, dataQuality: 0 },
      }),
    ).toThrow(/sum to 1/);
  });
});

describe("recommend with the sample catalog", () => {
  const sampleRun = (request: GiftRequest, options: Partial<EngineOptions> = {}) =>
    recommend({
      products: SAMPLE_PRODUCTS,
      request,
      exchangeRates: SAMPLE_EXCHANGE_RATES,
      now: SAMPLE_REFERENCE_DATE,
      options: { allowSampleProducts: true, ...options },
    });

  it("never returns sample products by default", () => {
    const result = recommend({
      products: SAMPLE_PRODUCTS,
      request: makeRequest({ interests: [] }),
      exchangeRates: SAMPLE_EXCHANGE_RATES,
      now: SAMPLE_REFERENCE_DATE,
    });
    expect(result.recommendations).toEqual([]);
    expect(result.excluded.every((e) => e.reasons.includes("sample_data_not_allowed"))).toBe(true);
  });

  it("marks every sample recommendation with a sample_data warning", () => {
    const result = sampleRun(makeRequest({ interests: [], recipient: "colleague", occasion: "housewarming" }));
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations.every((r) => r.warnings.includes("sample_data"))).toBe(true);
  });

  it("respects an avoid list end to end", () => {
    const request = makeRequest({ interests: [], recipient: "colleague", occasion: "housewarming", avoid: ["alcohol"] });
    const result = sampleRun(request);
    expect(ids(result)).not.toContain("sample-wine-gift-box");
    expect(result.excluded).toContainEqual({ productId: "sample-wine-gift-box", reasons: ["matches_avoid_list"] });
  });

  it("excludes slow international shipping for an urgent request", () => {
    const request = makeRequest({
      interests: ["hiking"],
      budget: { max: 400, currency: "ILS" },
      neededBy: new Date(SAMPLE_REFERENCE_DATE.getTime() + 7 * 86_400_000),
    });
    const result = sampleRun(request);
    expect(ids(result)).toEqual(["sample-camping-hammock"]);
    expect(result.excluded).toContainEqual({ productId: "sample-hiking-backpack", reasons: ["delivery_too_slow"] });
  });
});
