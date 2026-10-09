import { describe, expect, it } from "vitest";
import type { Product, ProductInput } from "../../src/domain/types.js";
import { applyHardFilters, matchesAvoidList, type ExclusionReason } from "../../src/recommendation/filters.js";
import { daysFromNow, makeContext, makeProduct, makeRequest, NOW } from "../helpers.js";

function reasonsFor(product: Product, ctx = makeContext()): ExclusionReason[] {
  const outcome = applyHardFilters(product, ctx);
  return outcome.passed ? [] : outcome.reasons;
}

describe("applyHardFilters", () => {
  it("passes a matching product and reports the facts used for scoring", () => {
    const outcome = applyHardFilters(makeProduct(), makeContext());
    expect(outcome).toEqual({ passed: true, convertedPrice: 200, ageDays: 0, isDomestic: true, daysAvailable: undefined });
  });

  describe("data", () => {
    it("excludes sample products unless explicitly allowed", () => {
      const product = makeProduct({ isSample: true });
      expect(reasonsFor(product)).toEqual(["sample_data_not_allowed"]);
      expect(reasonsFor(product, makeContext(makeRequest(), { allowSampleProducts: true }))).toEqual([]);
    });

    it("excludes out-of-stock products but keeps unknown availability", () => {
      expect(reasonsFor(makeProduct({ availability: "out_of_stock" }))).toEqual(["out_of_stock"]);
      expect(reasonsFor(makeProduct({ availability: "unknown" }))).toEqual([]);
    });

    it("excludes data older than maxDataAgeDays", () => {
      expect(reasonsFor(makeProduct({ lastVerifiedAt: daysFromNow(-90) }))).toEqual([]);
      expect(reasonsFor(makeProduct({ lastVerifiedAt: daysFromNow(-91) }))).toEqual(["data_too_stale"]);
    });

    it("rejects verification timestamps in the future (beyond clock-skew tolerance)", () => {
      expect(reasonsFor(makeProduct({ lastVerifiedAt: daysFromNow(0.5) }))).toEqual([]);
      expect(reasonsFor(makeProduct({ lastVerifiedAt: daysFromNow(3) }))).toEqual(["invalid_product_data"]);
    });

    it("guards against products that bypassed schema validation", () => {
      const bad = { ...makeProduct(), productUrl: "javascript:alert(1)" } as Product;
      expect(reasonsFor(bad)).toContain("invalid_product_data");
      const badPrice = { ...makeProduct(), price: { amount: Number.NaN, currency: "ILS" } } as Product;
      expect(reasonsFor(badPrice)).toContain("invalid_product_data");
    });
  });

  describe("budget", () => {
    it("allows up to budgetTolerance over the max", () => {
      expect(reasonsFor(makeProduct({ price: { amount: 330, currency: "ILS" } }))).toEqual([]);
      expect(reasonsFor(makeProduct({ price: { amount: 331, currency: "ILS" } }))).toEqual(["over_budget"]);
    });

    it("respects a zero tolerance", () => {
      const ctx = makeContext(makeRequest(), { budgetTolerance: 0 });
      expect(reasonsFor(makeProduct({ price: { amount: 300, currency: "ILS" } }), ctx)).toEqual([]);
      expect(reasonsFor(makeProduct({ price: { amount: 300.01, currency: "ILS" } }), ctx)).toEqual(["over_budget"]);
    });

    it("excludes items well under an explicit minimum", () => {
      const ctx = makeContext(makeRequest({ budget: { min: 200, max: 300, currency: "ILS" } }));
      expect(reasonsFor(makeProduct({ price: { amount: 180, currency: "ILS" } }), ctx)).toEqual([]);
      expect(reasonsFor(makeProduct({ price: { amount: 179, currency: "ILS" } }), ctx)).toEqual(["under_budget"]);
    });

    it("converts foreign prices before comparing", () => {
      // 80 USD * 4 = 320 ILS — within 10% tolerance of 300
      expect(reasonsFor(makeProduct({ price: { amount: 80, currency: "USD" } }))).toEqual([]);
      // 90 USD = 360 ILS — over
      expect(reasonsFor(makeProduct({ price: { amount: 90, currency: "USD" } }))).toEqual(["over_budget"]);
    });

    it("excludes products whose currency cannot be converted", () => {
      expect(reasonsFor(makeProduct({ price: { amount: 10, currency: "GBP" } }))).toEqual([
        "currency_conversion_unavailable",
      ]);
    });
  });

  describe("occasion and recipient", () => {
    it("requires an explicit or 'any' occasion match", () => {
      expect(reasonsFor(makeProduct({ occasions: ["wedding"] }))).toEqual(["occasion_mismatch"]);
      expect(reasonsFor(makeProduct({ occasions: ["any"] }))).toEqual([]);
    });

    it("requires an explicit or 'any' recipient match", () => {
      expect(reasonsFor(makeProduct({ recipients: ["baby"] }))).toEqual(["recipient_mismatch"]);
      expect(reasonsFor(makeProduct({ recipients: ["any"] }))).toEqual([]);
    });
  });

  describe("shipping and deadline", () => {
    const intl: Partial<ProductInput> = { storeCountry: "US", shipping: { shipsTo: ["IL", "US"], minDays: 7, maxDays: 14 } };

    it("allows international stores that ship to the delivery country", () => {
      expect(reasonsFor(makeProduct(intl))).toEqual([]);
    });

    it("excludes international stores when the user refused international shipping", () => {
      const ctx = makeContext(makeRequest({ allowInternationalShipping: false }));
      expect(reasonsFor(makeProduct(intl), ctx)).toEqual(["international_shipping_not_allowed"]);
    });

    it("excludes international stores that don't ship to the country, or whose coverage is unknown", () => {
      expect(reasonsFor(makeProduct({ ...intl, shipping: { shipsTo: ["US"] } }))).toEqual(["does_not_ship_to_country"]);
      expect(reasonsFor(makeProduct({ ...intl, shipping: undefined }))).toEqual(["shipping_to_country_unknown"]);
    });

    it("keeps domestic stores with unknown shipping details", () => {
      expect(reasonsFor(makeProduct({ shipping: undefined }))).toEqual([]);
    });

    it("uses the worst-case delivery estimate against the deadline", () => {
      const ctx = makeContext(makeRequest({ neededBy: daysFromNow(10) }));
      expect(reasonsFor(makeProduct({ shipping: { shipsTo: ["IL"], minDays: 3, maxDays: 10 } }), ctx)).toEqual([]);
      expect(reasonsFor(makeProduct({ shipping: { shipsTo: ["IL"], minDays: 3, maxDays: 11 } }), ctx)).toEqual([
        "delivery_too_slow",
      ]);
      expect(reasonsFor(makeProduct({ shipping: { shipsTo: ["IL"], minDays: 12 } }), ctx)).toEqual(["delivery_too_slow"]);
    });

    it("keeps products with unknown delivery time when there is a deadline (scored lower instead)", () => {
      const ctx = makeContext(makeRequest({ neededBy: daysFromNow(2) }));
      expect(reasonsFor(makeProduct({ shipping: { shipsTo: ["IL"] } }), ctx)).toEqual([]);
    });

    it("flags a deadline that has already passed", () => {
      const ctx = makeContext(makeRequest({ neededBy: new Date(NOW.getTime() - 1000) }));
      expect(reasonsFor(makeProduct(), ctx)).toEqual(["deadline_passed"]);
    });
  });

  it("collects every failing reason, not just the first", () => {
    const product = makeProduct({
      availability: "out_of_stock",
      price: { amount: 999, currency: "ILS" },
      occasions: ["wedding"],
      recipients: ["baby"],
    });
    expect(reasonsFor(product)).toEqual(["out_of_stock", "over_budget", "occasion_mismatch", "recipient_mismatch"]);
  });
});

describe("matchesAvoidList", () => {
  it("matches tags exactly", () => {
    expect(matchesAvoidList(makeProduct({ categories: ["alcohol"] }), ["alcohol"])).toBe(true);
    expect(matchesAvoidList(makeProduct({ interests: ["wine"] }), ["wine"])).toBe(true);
  });

  it("matches whole words in the name or description", () => {
    expect(matchesAvoidList(makeProduct({ name: "Red Wine Box" }), ["wine"])).toBe(true);
    expect(matchesAvoidList(makeProduct({ description: "Includes chocolate, nuts." }), ["nuts"])).toBe(true);
  });

  it("does not match substrings of other words", () => {
    expect(matchesAvoidList(makeProduct({ name: "Swine-shaped mug" }), ["wine"])).toBe(false);
  });

  it("matches multi-word phrases", () => {
    expect(matchesAvoidList(makeProduct({ name: "Dark chocolate bar" }), ["dark chocolate"])).toBe(true);
    expect(matchesAvoidList(makeProduct({ name: "Chocolate, dark roast" }), ["dark chocolate"])).toBe(false);
  });

  it("handles Hebrew words with an attached prefix letter", () => {
    expect(matchesAvoidList(makeProduct({ name: "מארז יין אדום" }), ["יין"])).toBe(true);
    expect(matchesAvoidList(makeProduct({ name: "כוסות ליין" }), ["יין"])).toBe(true);
    expect(matchesAvoidList(makeProduct({ name: "ספר בישול" }), ["יין"])).toBe(false);
  });

  it("returns false for an empty avoid list", () => {
    expect(matchesAvoidList(makeProduct({ categories: ["alcohol"] }), [])).toBe(false);
  });

  it("is applied as a hard filter", () => {
    const ctx = makeContext(makeRequest({ avoid: ["Coffee"] }));
    expect(applyHardFilters(makeProduct(), ctx)).toEqual({ passed: false, reasons: ["matches_avoid_list"] });
  });
});
