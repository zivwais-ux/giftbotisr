import { describe, expect, it } from "vitest";
import { SAMPLE_PRODUCTS } from "../../src/data/sample-products.js";
import { GiftRequestSchema, ProductSchema } from "../../src/domain/types.js";
import { makeProduct } from "../helpers.js";

const validRequest = { recipient: "friend", occasion: "birthday", budget: { max: 300, currency: "ILS" } };

describe("GiftRequestSchema", () => {
  it("applies safe defaults", () => {
    const req = GiftRequestSchema.parse(validRequest);
    expect(req.interests).toEqual([]);
    expect(req.avoid).toEqual([]);
    expect(req.deliveryCountry).toBe("IL");
    expect(req.allowInternationalShipping).toBe(true);
    expect(req.neededBy).toBeUndefined();
  });

  it("normalizes tags", () => {
    const req = GiftRequestSchema.parse({ ...validRequest, interests: ["  Board   Games "], avoid: ["ALCOHOL"] });
    expect(req.interests).toEqual(["board games"]);
    expect(req.avoid).toEqual(["alcohol"]);
  });

  it("parses neededBy from an ISO string", () => {
    const req = GiftRequestSchema.parse({ ...validRequest, neededBy: "2026-06-10" });
    expect(req.neededBy).toBeInstanceOf(Date);
  });

  it.each([
    ["min greater than max", { ...validRequest, budget: { min: 400, max: 300, currency: "ILS" } }],
    ["zero max budget", { ...validRequest, budget: { max: 0, currency: "ILS" } }],
    ["unsupported currency", { ...validRequest, budget: { max: 100, currency: "BTC" } }],
    ["unknown recipient", { ...validRequest, recipient: "boss" }],
    ["unknown occasion", { ...validRequest, occasion: "party" }],
    ["lowercase country", { ...validRequest, deliveryCountry: "il" }],
    ["empty interest tag", { ...validRequest, interests: ["  "] }],
  ])("rejects %s", (_label, input) => {
    expect(GiftRequestSchema.safeParse(input).success).toBe(false);
  });
});

describe("ProductSchema", () => {
  const base = makeProduct();

  it("accepts a valid product and keeps isSample false by default", () => {
    expect(base.isSample).toBe(false);
  });

  it.each([
    ["non-https product URL", { productUrl: "http://shop.test/p1" }],
    ["non-https image URL", { imageUrl: "http://shop.test/p1.jpg" }],
    ["negative price", { price: { amount: -5, currency: "ILS" } }],
    ["zero price", { price: { amount: 0, currency: "ILS" } }],
    ["no categories", { categories: [] }],
    ["no occasions", { occasions: [] }],
    ["minDays > maxDays", { shipping: { shipsTo: ["IL"], minDays: 5, maxDays: 2 } }],
    ["commission above 100%", { affiliateCommissionRate: 1.5 }],
  ])("rejects %s", (_label, override) => {
    expect(ProductSchema.safeParse({ ...base, ...override }).success).toBe(false);
  });
});

describe("sample catalog", () => {
  it("is clearly marked as sample data everywhere", () => {
    expect(SAMPLE_PRODUCTS.length).toBeGreaterThan(0);
    for (const p of SAMPLE_PRODUCTS) {
      expect(p.isSample).toBe(true);
      expect(p.dataSource).toBe("sample");
      expect(p.name.startsWith("[דוגמה]")).toBe(true);
      expect(p.id.startsWith("sample-")).toBe(true);
      expect(new URL(p.productUrl).hostname).toBe("example.com");
      if (p.imageUrl) expect(new URL(p.imageUrl).hostname).toBe("example.com");
      expect(p.affiliateUrl).toBeUndefined();
    }
  });

  it("has unique ids", () => {
    const ids = SAMPLE_PRODUCTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
