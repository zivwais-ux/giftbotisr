import { describe, expect, it } from "vitest";
import {
  budgetScore,
  dataQualityScore,
  deliveryScore,
  interestScore,
  scoreProduct,
  type ScoreFacts,
} from "../../src/recommendation/scoring.js";
import { makeContext, makeProduct, makeRequest } from "../helpers.js";

const domesticFacts: ScoreFacts = { convertedPrice: 200, ageDays: 0, isDomestic: true, daysAvailable: undefined };

describe("interestScore", () => {
  const product = makeProduct({ interests: ["coffee", "cooking"], categories: ["kitchen"] });

  it("is neutral when the user stated no interests", () => {
    expect(interestScore(product, [])).toEqual({ interests: 0.5, matched: [] });
  });

  it("gives full credit for matching a single stated interest", () => {
    expect(interestScore(product, ["coffee"])).toEqual({ interests: 1, matched: ["coffee"] });
  });

  it("gives full credit for two matches, half for one of several", () => {
    expect(interestScore(product, ["coffee", "cooking", "music"]).interests).toBe(1);
    expect(interestScore(product, ["coffee", "music", "art"]).interests).toBe(0.5);
  });

  it("matches categories as well as interests", () => {
    expect(interestScore(product, ["kitchen"]).matched).toEqual(["kitchen"]);
  });

  it("ignores duplicate request tags", () => {
    expect(interestScore(product, ["music", "music"]).interests).toBe(0);
  });
});

describe("budgetScore", () => {
  const ctx = makeContext(makeRequest({ budget: { max: 100, currency: "ILS" } }));

  it.each([
    [100, 1],
    [60, 1],
    [30, 0.7],
    [1, 0.41],
    [105, 0.75],
    [110, 0.5],
  ])("price %d of max 100 scores %d", (price, expected) => {
    expect(budgetScore(price, ctx)).toBeCloseTo(expected, 5);
  });

  it("scores anything within an explicit [min, max] range as 1", () => {
    const ranged = makeContext(makeRequest({ budget: { min: 20, max: 100, currency: "ILS" } }));
    expect(budgetScore(25, ranged)).toBe(1);
    expect(budgetScore(19, ranged)).toBe(0.7);
  });
});

describe("deliveryScore", () => {
  it("prefers a known estimate when there is no deadline", () => {
    expect(deliveryScore(makeProduct(), domesticFacts)).toBe(1);
    expect(deliveryScore(makeProduct({ shipping: undefined }), domesticFacts)).toBe(0.6);
  });

  it("rewards slack before a deadline and penalizes unknown estimates", () => {
    const facts = { ...domesticFacts, daysAvailable: 5 };
    expect(deliveryScore(makeProduct({ shipping: { shipsTo: ["IL"], maxDays: 3 } }), facts)).toBe(1);
    expect(deliveryScore(makeProduct({ shipping: { shipsTo: ["IL"], maxDays: 4 } }), facts)).toBe(0.75);
    expect(deliveryScore(makeProduct({ shipping: { shipsTo: ["IL"] } }), facts)).toBe(0.3);
  });

  it("applies a small factor for international shipping", () => {
    expect(deliveryScore(makeProduct(), { ...domesticFacts, isDomestic: false })).toBe(0.9);
  });
});

describe("dataQualityScore", () => {
  const ctx = makeContext();

  it("is 1 for fresh, in-stock data with an image", () => {
    expect(dataQualityScore(makeProduct(), 0, ctx)).toBe(1);
    expect(dataQualityScore(makeProduct(), 7, ctx)).toBe(1);
  });

  it("decays with age down to 0.4 at the max age", () => {
    expect(dataQualityScore(makeProduct(), 90, ctx)).toBeCloseTo(0.4, 5);
  });

  it("penalizes unknown availability and a missing image", () => {
    expect(dataQualityScore(makeProduct({ availability: "unknown" }), 0, ctx)).toBeCloseTo(0.6, 5);
    expect(dataQualityScore(makeProduct({ imageUrl: undefined }), 0, ctx)).toBeCloseTo(0.9, 5);
  });
});

describe("scoreProduct", () => {
  it("returns a perfect score for a perfect match", () => {
    const result = scoreProduct(makeProduct(), domesticFacts, makeContext());
    expect(result.score).toBe(1);
    expect(result.matchedInterests).toEqual(["coffee"]);
  });

  it("applies the configured weights", () => {
    // interests 0 (no match) with all weight on interests → score 0
    const ctx = makeContext(makeRequest({ interests: ["music"] }), {
      weights: { interests: 1, occasionAndRecipient: 0, budget: 0, delivery: 0, dataQuality: 0 },
    });
    expect(scoreProduct(makeProduct(), domesticFacts, ctx).score).toBe(0);
  });

  it("keeps every component within [0, 1]", () => {
    const product = makeProduct({ availability: "unknown", imageUrl: undefined, shipping: undefined });
    const { components } = scoreProduct(product, { ...domesticFacts, ageDays: 90, daysAvailable: 1 }, makeContext());
    for (const value of Object.values(components)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
