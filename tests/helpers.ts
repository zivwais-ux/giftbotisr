import type { ExchangeRates } from "../src/domain/money.js";
import {
  parseGiftRequest,
  parseProduct,
  type GiftRequest,
  type GiftRequestInput,
  type Product,
  type ProductInput,
} from "../src/domain/types.js";
import { resolveOptions, type EngineContext, type EngineOptions } from "../src/recommendation/context.js";

/** Fixed clock for all tests. */
export const NOW = new Date("2026-06-01T12:00:00Z");
export const DAY = 24 * 60 * 60 * 1000;
export const daysFromNow = (days: number) => new Date(NOW.getTime() + days * DAY);

/** Test-only rates. */
export const RATES: ExchangeRates = { toIls: { USD: 4, EUR: 4.5 }, asOf: NOW };

/** A valid, in-stock, domestic product matching a typical birthday request. Override any field. */
export function makeProduct(overrides: Partial<ProductInput> = {}): Product {
  return parseProduct({
    id: "p1",
    name: "Test product",
    description: "",
    price: { amount: 200, currency: "ILS" },
    imageUrl: "https://shop.test/p1.jpg",
    productUrl: "https://shop.test/p1",
    storeId: "store-il",
    storeCountry: "IL",
    availability: "in_stock",
    shipping: { shipsTo: ["IL"], minDays: 1, maxDays: 3 },
    categories: ["kitchen"],
    interests: ["coffee"],
    occasions: ["birthday"],
    recipients: ["friend"],
    lastVerifiedAt: NOW,
    dataSource: "test",
    ...overrides,
  });
}

export function makeRequest(overrides: Partial<GiftRequestInput> = {}): GiftRequest {
  return parseGiftRequest({
    recipient: "friend",
    occasion: "birthday",
    budget: { max: 300, currency: "ILS" },
    interests: ["coffee"],
    ...overrides,
  });
}

export function makeContext(
  request: GiftRequest = makeRequest(),
  options: Partial<EngineOptions> = {},
): EngineContext {
  return { request, now: NOW, exchangeRates: RATES, options: resolveOptions(options) };
}
