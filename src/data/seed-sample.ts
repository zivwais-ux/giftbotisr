import { upsertProduct, upsertStore, type StoreInput } from "../db/catalog-repository.js";
import type { Database } from "../db/database.js";
import { SAMPLE_PRODUCTS, SAMPLE_REFERENCE_DATE } from "./sample-products.js";

/** ⚠️ Fictional stores for the sample catalog. Marked is_sample so they never reach real users. */
const SAMPLE_STORES: Record<string, Pick<StoreInput, "slug" | "name" | "country" | "defaultCurrency">> = {
  "sample-store-il": { slug: "sample-store-il", name: "[דוגמה] חנות ישראלית", country: "IL", defaultCurrency: "ILS" },
  "sample-store-intl": { slug: "sample-store-intl", name: "[דוגמה] חנות אמריקאית", country: "US", defaultCurrency: "USD" },
  "sample-store-uk": { slug: "sample-store-uk", name: "[דוגמה] חנות בריטית", country: "GB", defaultCurrency: "GBP" },
};

/**
 * Loads the sample catalog into the database (idempotent — safe to run repeatedly).
 * Returns a map from sample product id (e.g. "sample-wine-gift-box") to its database id.
 */
export async function seedSampleCatalog(db: Database): Promise<Map<string, string>> {
  const storeIds = new Map<string, string>();
  for (const [key, store] of Object.entries(SAMPLE_STORES)) {
    const id = await upsertStore(db, {
      ...store,
      dataSource: "sample",
      approvalStatus: "approved",
      allowsMessagingLinks: true,
      allowsProductImages: true,
      requiresAffiliateDisclosure: true,
      termsNotes: "Fictional sample store for development only — no real terms exist.",
      termsReviewedAt: SAMPLE_REFERENCE_DATE,
      isSample: true,
    });
    storeIds.set(key, id);
  }

  const productIds = new Map<string, string>();
  for (const product of SAMPLE_PRODUCTS) {
    const storeId = storeIds.get(product.storeId);
    if (!storeId) throw new Error(`Sample product ${product.id} references unknown store ${product.storeId}`);
    const { id, storeId: _store, storeCountry: _country, ...fields } = product;
    productIds.set(id, await upsertProduct(db, storeId, { ...fields, externalId: id }));
  }
  return productIds;
}
