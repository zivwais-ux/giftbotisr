import type { Currency, Money } from "./types.js";

/**
 * Exchange rates expressed as "how many ILS is 1 unit of this currency".
 * Rates must come from a real, dated source supplied by the caller — the engine never invents them.
 * A currency missing from the table cannot be converted.
 */
export interface ExchangeRates {
  /** Value of one unit of each currency in ILS. ILS itself is always 1. */
  toIls: Partial<Record<Currency, number>>;
  /** When the rates were fetched; surfaced so callers can tell users prices are approximate. */
  asOf: Date;
}

/** Converts money to the target currency, or returns undefined when a rate is unavailable. */
export function convert(money: Money, to: Currency, rates: ExchangeRates): number | undefined {
  if (money.currency === to) return money.amount;
  const fromRate = rateToIls(money.currency, rates);
  const toRate = rateToIls(to, rates);
  if (fromRate === undefined || toRate === undefined) return undefined;
  return roundMoney((money.amount * fromRate) / toRate);
}

function rateToIls(currency: Currency, rates: ExchangeRates): number | undefined {
  if (currency === "ILS") return 1;
  const rate = rates.toIls[currency];
  return rate !== undefined && Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}
