import { StoreConfigSchema, type StoreConfig } from "../../src/catalog/store-config.js";

/** An approved test store; override any field. */
export function makeStore(overrides: Record<string, unknown> = {}): StoreConfig {
  return StoreConfigSchema.parse({
    slug: "test-store",
    name: "Test Store",
    country: "IL",
    currency: "ILS",
    websiteUrl: "https://shop.test",
    dataSource: "test-feed",
    terms: {
      approvalStatus: "approved",
      allowsMessagingLinks: true,
      allowsProductImages: true,
      reviewedAt: "2026-10-01",
    },
    defaults: { shipsTo: ["IL"], deliveryMinDays: 1, deliveryMaxDays: 4 },
    ...overrides,
  });
}
