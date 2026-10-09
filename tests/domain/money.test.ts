import { describe, expect, it } from "vitest";
import { convert, type ExchangeRates } from "../../src/domain/money.js";

const rates: ExchangeRates = { toIls: { USD: 4, EUR: 4.5 }, asOf: new Date("2026-06-01") };

describe("convert", () => {
  it("returns the same amount for the same currency", () => {
    expect(convert({ amount: 99.9, currency: "USD" }, "USD", rates)).toBe(99.9);
  });

  it("converts foreign currency to ILS and back", () => {
    expect(convert({ amount: 25, currency: "USD" }, "ILS", rates)).toBe(100);
    expect(convert({ amount: 100, currency: "ILS" }, "USD", rates)).toBe(25);
  });

  it("converts between two foreign currencies via ILS", () => {
    expect(convert({ amount: 45, currency: "EUR" }, "USD", rates)).toBe(50.63);
  });

  it("rounds to 2 decimals", () => {
    expect(convert({ amount: 10, currency: "ILS" }, "USD", { ...rates, toIls: { USD: 3 } })).toBe(3.33);
  });

  it("returns undefined when a rate is missing or invalid — never guesses", () => {
    expect(convert({ amount: 10, currency: "GBP" }, "ILS", rates)).toBeUndefined();
    expect(convert({ amount: 10, currency: "ILS" }, "GBP", rates)).toBeUndefined();
    expect(convert({ amount: 10, currency: "USD" }, "ILS", { ...rates, toIls: { USD: 0 } })).toBeUndefined();
    expect(convert({ amount: 10, currency: "USD" }, "ILS", { ...rates, toIls: { USD: Number.NaN } })).toBeUndefined();
  });
});
