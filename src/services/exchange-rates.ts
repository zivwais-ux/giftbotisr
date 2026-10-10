import type { ExchangeRates } from "../domain/money.js";
import type { Currency } from "../domain/types.js";
import type { Logger } from "../logger.js";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type ForeignCurrency = Exclude<Currency, "ILS">;

const FOREIGN: readonly ForeignCurrency[] = ["USD", "EUR", "GBP"];
export const BOI_URL = "https://www.boi.org.il/PublicApi/GetExchangeRates?asXml=false";
export const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest?base=ILS&symbols=USD,EUR,GBP";

/** Rates older than this are no longer trusted: better to hide foreign-currency products than misprice them. */
const MAX_STALE_MS = 3 * 24 * 60 * 60 * 1000;
const REFRESH_MS = 6 * 60 * 60 * 1000;
/** How soon to retry after a failure. */
const RETRY_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

const NO_RATES: ExchangeRates = { toIls: {}, asOf: new Date(0) };

/** An ILS-per-unit rate outside this band is a parsing mistake, not a market move. */
function plausible(rate: unknown): rate is number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0.5 && rate < 20;
}

async function getJson(fetchFn: FetchLike, url: string): Promise<unknown> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Bank of Israel representative rates: { exchangeRates: [{ key: "USD", currentExchangeRate: 3.7, unit: 1, lastUpdate }] }. */
export async function fetchBankOfIsraelRates(fetchFn: FetchLike): Promise<ExchangeRates> {
  const body = (await getJson(fetchFn, BOI_URL)) as {
    exchangeRates?: { key?: string; currentExchangeRate?: number; unit?: number; lastUpdate?: string }[];
  };
  const toIls: ExchangeRates["toIls"] = {};
  let asOf: Date | undefined;
  for (const r of body.exchangeRates ?? []) {
    const key = r.key as ForeignCurrency;
    if (!FOREIGN.includes(key)) continue;
    const perUnit = (r.currentExchangeRate ?? NaN) / (r.unit && r.unit > 0 ? r.unit : 1);
    if (!plausible(perUnit)) throw new Error(`implausible ${key} rate`);
    toIls[key] = perUnit;
    const updated = r.lastUpdate ? new Date(r.lastUpdate) : undefined;
    if (updated && !Number.isNaN(updated.getTime()) && (!asOf || updated < asOf)) asOf = updated;
  }
  if (FOREIGN.some((c) => toIls[c] === undefined)) throw new Error("missing currencies in response");
  return { toIls, asOf: asOf ?? new Date() };
}

/** Frankfurter (European Central Bank reference rates), used only if the Bank of Israel is unreachable. */
export async function fetchFrankfurterRates(fetchFn: FetchLike): Promise<ExchangeRates> {
  const body = (await getJson(fetchFn, FRANKFURTER_URL)) as { date?: string; rates?: Record<string, number> };
  const toIls: ExchangeRates["toIls"] = {};
  for (const c of FOREIGN) {
    const ilsToForeign = body.rates?.[c];
    if (typeof ilsToForeign !== "number" || !(ilsToForeign > 0)) throw new Error(`missing ${c} rate`);
    const perUnit = 1 / ilsToForeign;
    if (!plausible(perUnit)) throw new Error(`implausible ${c} rate`);
    toIls[c] = perUnit;
  }
  const asOf = body.date ? new Date(body.date) : new Date();
  return { toIls, asOf: Number.isNaN(asOf.getTime()) ? new Date() : asOf };
}

export interface ExchangeRateProvider {
  /** Current rates; empty (foreign-currency products excluded) when none are available or all are too old. */
  get(): Promise<ExchangeRates>;
  /** Forces a refresh; resolves when done. Never rejects. */
  refresh(): Promise<void>;
}

export function createExchangeRateProvider(
  logger: Logger,
  options: { fetchFn?: FetchLike; now?: () => number } = {},
): ExchangeRateProvider {
  const fetchFn: FetchLike = options.fetchFn ?? fetch;
  const now = options.now ?? Date.now;
  let current: ExchangeRates | undefined;
  let fetchedAt = 0;
  let nextAttemptAt = 0;
  let inFlight: Promise<void> | undefined;

  async function doRefresh(): Promise<void> {
    const sources: [string, () => Promise<ExchangeRates>][] = [
      ["bank_of_israel", () => fetchBankOfIsraelRates(fetchFn)],
      ["frankfurter_ecb", () => fetchFrankfurterRates(fetchFn)],
    ];
    for (const [name, load] of sources) {
      try {
        const rates = await load();
        current = rates;
        fetchedAt = now();
        nextAttemptAt = now() + REFRESH_MS;
        logger.log("info", "exchange_rates.updated", {
          source: name,
          asOf: rates.asOf.toISOString(),
          usd: rates.toIls.USD,
          eur: rates.toIls.EUR,
          gbp: rates.toIls.GBP,
        });
        return;
      } catch (err) {
        logger.log("warn", "exchange_rates.source_failed", { source: name, error: (err as Error).message });
      }
    }
    nextAttemptAt = now() + RETRY_MS;
    logger.log("error", "exchange_rates.unavailable", {
      effect: current ? "keeping previous rates until they are too old" : "foreign-currency products are excluded",
    });
  }

  function refresh(): Promise<void> {
    inFlight ??= doRefresh().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  return {
    refresh,
    async get() {
      if (now() >= nextAttemptAt) await refresh();
      if (!current) return NO_RATES;
      // Staleness is measured from the last successful fetch, not the (older) publication date.
      if (now() - fetchedAt > MAX_STALE_MS) return NO_RATES;
      return current;
    },
  };
}
