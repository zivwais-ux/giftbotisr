import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  deactivateProduct,
  loadActiveProducts,
  upsertProduct,
  upsertStore,
  type CatalogProductInput,
  type StoreInput,
} from "../../src/db/catalog-repository.js";
import type { Database } from "../../src/db/database.js";
import { createTestDatabase, resetTables } from "../db-helpers.js";

let db: Database;

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);
afterAll(async () => db?.close());
beforeEach(async () => resetTables(db));

const APPROVED_STORE: StoreInput = {
  slug: "shop-il",
  name: "Shop IL",
  country: "IL",
  defaultCurrency: "ILS",
  dataSource: "test-feed",
  approvalStatus: "approved",
  allowsMessagingLinks: true,
  allowsProductImages: true,
  termsReviewedAt: new Date("2026-06-01T00:00:00Z"),
};

const PRODUCT: CatalogProductInput = {
  externalId: "sku-1",
  name: "Espresso cups",
  description: "Set of 4",
  price: { amount: 199.99, currency: "ILS" },
  imageUrl: "https://shop.test/cups.jpg",
  productUrl: "https://shop.test/cups",
  affiliateUrl: "https://aff.test/cups",
  affiliateCommissionRate: 0.05,
  availability: "in_stock",
  shipping: { shipsTo: ["IL"], minDays: 1, maxDays: 3 },
  categories: ["kitchen", "gifts"],
  interests: ["coffee"],
  occasions: ["birthday", "housewarming"],
  recipients: ["any"],
  lastVerifiedAt: new Date("2026-06-01T10:00:00Z"),
  dataSource: "test-feed",
};

describe("upsertStore", () => {
  it("is idempotent by slug and updates fields", async () => {
    const id1 = await upsertStore(db, APPROVED_STORE);
    const id2 = await upsertStore(db, { ...APPROVED_STORE, name: "Renamed" });
    expect(id2).toBe(id1);
    const { rows } = await db.query<{ name: string }>("select name from public.stores");
    expect(rows).toEqual([{ name: "Renamed" }]);
  });

  it("validates input before touching the database", async () => {
    await expect(upsertStore(db, { ...APPROVED_STORE, country: "Israel" })).rejects.toThrow();
  });
});

describe("upsertProduct + loadActiveProducts", () => {
  it("round-trips a product exactly, preserving category order", async () => {
    const storeId = await upsertStore(db, APPROVED_STORE);
    const id = await upsertProduct(db, storeId, PRODUCT);
    const { products, invalid } = await loadActiveProducts(db);

    expect(invalid).toEqual([]);
    const { externalId: _ext, ...expected } = PRODUCT;
    expect(products).toEqual([
      { ...expected, id, storeId, storeCountry: "IL", isSample: false },
    ]);
    expect(products[0]!.categories[0]).toBe("kitchen"); // primary category stays first
  });

  it("updates in place on re-import and replaces attributes", async () => {
    const storeId = await upsertStore(db, APPROVED_STORE);
    const id1 = await upsertProduct(db, storeId, PRODUCT);
    const id2 = await upsertProduct(db, storeId, {
      ...PRODUCT,
      price: { amount: 149.5, currency: "ILS" },
      interests: ["tea"],
      categories: ["gifts"],
    });
    expect(id2).toBe(id1);
    const [product] = (await loadActiveProducts(db)).products;
    expect(product?.price).toEqual({ amount: 149.5, currency: "ILS" });
    expect(product?.interests).toEqual(["tea"]);
    expect(product?.categories).toEqual(["gifts"]);
  });

  it("stores a product without shipping info as unknown shipping", async () => {
    const storeId = await upsertStore(db, APPROVED_STORE);
    await upsertProduct(db, storeId, { ...PRODUCT, shipping: undefined });
    expect((await loadActiveProducts(db)).products[0]?.shipping).toBeUndefined();
  });

  it("rejects an unknown store without leaving partial data", async () => {
    const storeId = await upsertStore(db, APPROVED_STORE);
    await expect(
      upsertProduct(db, "00000000-0000-0000-0000-000000000000", PRODUCT),
    ).rejects.toThrow(/foreign key/);
    expect((await db.query("select 1 from public.products")).rows).toHaveLength(0);
    expect(storeId).toBeTypeOf("string");
  });

  it("only loads products from approved stores, and only active ones", async () => {
    const approved = await upsertStore(db, APPROVED_STORE);
    const pending = await upsertStore(db, { ...APPROVED_STORE, slug: "pending", approvalStatus: "pending" });
    const suspended = await upsertStore(db, { ...APPROVED_STORE, slug: "suspended", approvalStatus: "suspended" });
    const keep = await upsertProduct(db, approved, PRODUCT);
    const inactive = await upsertProduct(db, approved, { ...PRODUCT, externalId: "sku-2" });
    await deactivateProduct(db, inactive);
    await upsertProduct(db, pending, PRODUCT);
    await upsertProduct(db, suspended, PRODUCT);

    expect((await loadActiveProducts(db)).products.map((p) => p.id)).toEqual([keep]);
  });

  it("re-activates a deactivated product when it is imported again", async () => {
    const storeId = await upsertStore(db, APPROVED_STORE);
    const id = await upsertProduct(db, storeId, PRODUCT);
    await deactivateProduct(db, id);
    await upsertProduct(db, storeId, PRODUCT);
    expect((await loadActiveProducts(db)).products).toHaveLength(1);
  });

  it("hides sample products and sample stores unless asked", async () => {
    const real = await upsertStore(db, APPROVED_STORE);
    const sampleStore = await upsertStore(db, { ...APPROVED_STORE, slug: "sample", isSample: true });
    await upsertProduct(db, real, { ...PRODUCT, externalId: "sample-in-real-store", isSample: true });
    await upsertProduct(db, sampleStore, PRODUCT);
    const realId = await upsertProduct(db, real, PRODUCT);

    expect((await loadActiveProducts(db)).products.map((p) => p.id)).toEqual([realId]);
    expect((await loadActiveProducts(db, { includeSample: true })).products).toHaveLength(3);
  });

  it("drops images when the store hasn't allowed using them", async () => {
    const storeId = await upsertStore(db, { ...APPROVED_STORE, allowsProductImages: undefined });
    await upsertProduct(db, storeId, PRODUCT);
    expect((await loadActiveProducts(db)).products[0]?.imageUrl).toBeUndefined();
  });

  it("reports rows that fail validation instead of crashing", async () => {
    const storeId = await upsertStore(db, APPROVED_STORE);
    const good = await upsertProduct(db, storeId, PRODUCT);
    const bad = await upsertProduct(db, storeId, { ...PRODUCT, externalId: "sku-bad" });
    // Simulate corrupted data: a product left without any category.
    await db.query("delete from public.product_attributes where product_id = $1 and kind = 'category'", [bad]);

    const { products, invalid } = await loadActiveProducts(db);
    expect(products.map((p) => p.id)).toEqual([good]);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.productId).toBe(bad);
    expect(invalid[0]?.issues.join(" ")).toMatch(/categories/);
  });
});
