import { describe, expect, it } from "vitest";
import { mapRow, parsePrice, splitCategoryPath } from "../../src/catalog/row-mapper.js";
import { StoreConfigSchema, buildAffiliateUrl } from "../../src/catalog/store-config.js";
import { makeStore } from "./helpers.js";

const NOW = new Date("2026-10-09T10:00:00Z");


const ROW = {
  id: "SKU-1",
  title: "ספל קרמיקה לאוהבי קפה",
  description: "<p>ספל&nbsp;350 מ״ל</p>",
  price: "89.90 ILS",
  link: "https://shop.test/p/1",
  image_link: "https://shop.test/i/1.jpg",
  availability: "in stock",
  product_type: "בית > מטבח > ספלים",
};

describe("mapRow", () => {
  it("maps a complete row into a valid product", () => {
    const m = mapRow(ROW, 1, makeStore(), NOW);
    expect(m.errors).toEqual([]);
    expect(m.warnings).toEqual([]);
    expect(m.autoTagged).toBe(true);
    expect(m.product).toEqual({
      externalId: "SKU-1",
      name: "ספל קרמיקה לאוהבי קפה",
      description: "ספל 350 מ״ל",
      price: { amount: 89.9, currency: "ILS" },
      imageUrl: "https://shop.test/i/1.jpg",
      productUrl: "https://shop.test/p/1",
      affiliateUrl: undefined,
      availability: "in_stock",
      shipping: { shipsTo: ["IL"], minDays: 1, maxDays: 4 },
      categories: ["ספלים", "מטבח", "בית"],
      interests: ["coffee", "cooking"],
      occasions: ["any"],
      recipients: ["any"],
      lastVerifiedAt: NOW,
      dataSource: "test-feed",
      isSample: false,
    });
  });

  it("prefers explicit tag columns over inference", () => {
    const m = mapRow({ ...ROW, interests: "music|Reading", occasions: "birthday,wedding", recipients: "partner" }, 1, makeStore(), NOW);
    expect(m.product).toMatchObject({ interests: ["music", "reading"], occasions: ["birthday", "wedding"], recipients: ["partner"] });
    expect(m.autoTagged).toBe(false);
  });

  it("uses a lower sale price", () => {
    expect(mapRow({ ...ROW, sale_price: "69.90 ILS" }, 1, makeStore(), NOW).product?.price.amount).toBe(69.9);
    expect(mapRow({ ...ROW, sale_price: "99 ILS" }, 1, makeStore(), NOW).product?.price.amount).toBe(89.9);
  });

  it("builds affiliate links from the store template, unless the row has its own", () => {
    const store = makeStore({ affiliateLinkTemplate: "https://track.test/c?aff=7&url={url}" });
    expect(mapRow(ROW, 1, store, NOW).product?.affiliateUrl).toBe("https://track.test/c?aff=7&url=https%3A%2F%2Fshop.test%2Fp%2F1");
    expect(mapRow({ ...ROW, affiliate_url: "https://own.test/x" }, 1, store, NOW).product?.affiliateUrl).toBe("https://own.test/x");
  });

  it.each([
    ["missing price", { price: "" }, /price/],
    ["unreadable price", { price: "call us" }, /price/],
    ["http link", { link: "http://shop.test/p/1" }, /https/],
    ["missing link", { link: "" }, /productUrl/],
    ["missing id", { id: "" }, /externalId/],
    ["missing title", { title: "" }, /name/],
    ["unknown occasion", { occasions: "party" }, /occasions/],
  ])("rejects a row with %s", (_label, override, pattern) => {
    const m = mapRow({ ...ROW, ...override }, 3, makeStore(), NOW);
    expect(m.product).toBeUndefined();
    expect(m.errors.join(" ")).toMatch(pattern);
  });

  it("drops non-https images with a warning instead of rejecting the product", () => {
    const m = mapRow({ ...ROW, image_link: "http://shop.test/i.jpg" }, 1, makeStore(), NOW);
    expect(m.product?.imageUrl).toBeUndefined();
    expect(m.warnings).toContain("image: not https — image dropped");
  });

  it("warns about missing data it can live with", () => {
    const m = mapRow({ id: "2", title: "ארנק עור", price: "120", link: "https://shop.test/p/2" }, 1, makeStore(), NOW);
    expect(m.product).toMatchObject({ categories: ["general"], interests: [], availability: "unknown" });
    expect(m.warnings).toEqual([
      "no image",
      'no category — using "general"',
      "no interest tags — shown only for 'no specific interest'",
      "availability unknown",
    ]);
  });

  it.each([
    ["instock", "in_stock"],
    ["Out of Stock", "out_of_stock"],
    ["אזל מהמלאי", "out_of_stock"],
    ["preorder", "unknown"],
  ])("availability %s → %s", (value, expected) => {
    expect(mapRow({ ...ROW, availability: value }, 1, makeStore(), NOW).product?.availability).toBe(expected);
  });

  it("never dates a product in the future", () => {
    expect(mapRow({ ...ROW, updated_at: "2030-01-01" }, 1, makeStore(), NOW).product?.lastVerifiedAt).toEqual(NOW);
    expect(mapRow({ ...ROW, updated_at: "2026-10-08T00:00:00Z" }, 1, makeStore(), NOW).product?.lastVerifiedAt).toEqual(
      new Date("2026-10-08T00:00:00Z"),
    );
  });

  it("marks products from a sample store as sample data", () => {
    expect(mapRow(ROW, 1, makeStore({ isSample: true }), NOW).product?.isSample).toBe(true);
  });
});

describe("parsePrice", () => {
  it.each([
    ["149.90 ILS", { amount: 149.9, currency: "ILS" }],
    ["₪1,299", { amount: 1299, currency: "ILS" }],
    ['99 ש"ח', { amount: 99, currency: "ILS" }],
    ["149,90", { amount: 149.9, currency: "ILS" }],
    ["$25.00", { amount: 25, currency: "USD" }],
    ["30 EUR", { amount: 30, currency: "EUR" }],
  ])("%s", (input, expected) => {
    expect(parsePrice(input, undefined, "ILS")).toEqual(expected);
  });

  it("uses the currency column, then the store currency", () => {
    expect(parsePrice("10", "USD", "ILS")).toEqual({ amount: 10, currency: "USD" });
    expect(parsePrice("10", undefined, "GBP")).toEqual({ amount: 10, currency: "GBP" });
  });

  it.each(["", "free", "0", "-5", "- 5 ILS", "10-20"])("rejects %j", (input) => {
    expect(parsePrice(input, undefined, "ILS")).toBeUndefined();
  });
});

describe("splitCategoryPath", () => {
  it("puts the most specific category first and drops numeric ids", () => {
    expect(splitCategoryPath("Home > Kitchen > Mugs")).toEqual(["mugs", "kitchen", "home"]);
    expect(splitCategoryPath("536 > Home")).toEqual(["home"]);
    expect(splitCategoryPath("A > B > C > D")).toEqual(["d", "c", "b"]);
  });
});

describe("store config", () => {
  it("refuses 'approved' without a recorded review that allows messaging links", () => {
    const base = makeStore();
    const parse = (terms: object) => StoreConfigSchema.safeParse({ ...base, terms: { ...base.terms, ...terms } }).success;
    expect(parse({ reviewedAt: null })).toBe(false);
    expect(parse({ allowsMessagingLinks: null })).toBe(false);
    expect(parse({ allowsMessagingLinks: false })).toBe(false);
    expect(parse({ approvalStatus: "pending", allowsMessagingLinks: null, reviewedAt: null })).toBe(true);
  });

  it("validates the affiliate link template", () => {
    expect(() => makeStore({ affiliateLinkTemplate: "https://track.test/no-placeholder" })).toThrow();
    expect(() => makeStore({ affiliateLinkTemplate: "http://track.test/?u={url}" })).toThrow();
    expect(buildAffiliateUrl("https://t.test/?u={rawUrl}", "https://a.test/x?y=1")).toBe("https://t.test/?u=https://a.test/x?y=1");
  });
});
