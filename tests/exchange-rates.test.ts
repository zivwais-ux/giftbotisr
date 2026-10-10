import { describe, expect, it } from "vitest";
import { createExchangeRateProvider, fetchBankOfIsraelRates, fetchFrankfurterRates } from "../src/services/exchange-rates.js";
import { silentLogger } from "../src/logger.js";

const boi = {
  exchangeRates: [
    { key: "USD", currentExchangeRate: 3.7, unit: 1, lastUpdate: "2026-10-09T12:00:00Z" },
    { key: "EUR", currentExchangeRate: 4.3, unit: 1, lastUpdate: "2026-10-09T12:00:00Z" },
    { key: "GBP", currentExchangeRate: 4.9, unit: 1, lastUpdate: "2026-10-09T12:00:00Z" },
    { key: "JPY", currentExchangeRate: 2.5, unit: 100, lastUpdate: "2026-10-09T12:00:00Z" },
  ],
};
const ecb = { date: "2026-10-09", rates: { USD: 0.27, EUR: 0.2325, GBP: 0.2041 } };

const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body }) as Response;

describe("exchange rates", () => {
  it("parses Bank of Israel rates and ignores other currencies", async () => {
    const r = await fetchBankOfIsraelRates(async () => json(boi));
    expect(r.toIls).toEqual({ USD: 3.7, EUR: 4.3, GBP: 4.9 });
    expect(r.asOf.toISOString()).toBe("2026-10-09T12:00:00.000Z");
  });

  it("rejects implausible or incomplete data", async () => {
    await expect(fetchBankOfIsraelRates(async () => json({ exchangeRates: [{ key: "USD", currentExchangeRate: 370, unit: 1 }] }))).rejects.toThrow(/implausible/);
    await expect(fetchBankOfIsraelRates(async () => json({ exchangeRates: boi.exchangeRates.slice(0, 2) }))).rejects.toThrow(/missing/);
  });

  it("inverts Frankfurter ILS-based rates", async () => {
    const r = await fetchFrankfurterRates(async () => json(ecb));
    expect(r.toIls.USD).toBeCloseTo(3.7037, 3);
  });

  it("falls back to Frankfurter when the Bank of Israel fails", async () => {
    const p = createExchangeRateProvider(silentLogger, {
      fetchFn: async (url) => (url.includes("boi.org.il") ? json({}, false) : json(ecb)),
    });
    expect((await p.get()).toIls.USD).toBeCloseTo(3.7037, 3);
  });

  it("returns no rates when every source fails, and never throws", async () => {
    const p = createExchangeRateProvider(silentLogger, { fetchFn: async () => { throw new Error("offline"); } });
    expect((await p.get()).toIls).toEqual({});
  });

  it("caches, refreshes after 6h, keeps old rates on failure, and drops them after 3 days", async () => {
    let t = 1_000_000;
    let calls = 0;
    let fail = false;
    const p = createExchangeRateProvider(silentLogger, {
      now: () => t,
      fetchFn: async () => {
        calls++;
        if (fail) throw new Error("down");
        return json(boi);
      },
    });
    await p.get();
    await p.get();
    expect(calls).toBe(1);
    fail = true;
    t += 7 * 3600_000;
    expect((await p.get()).toIls.USD).toBe(3.7); // refresh fails (both sources), previous rates kept
    t += 3 * 24 * 3600_000;
    expect((await p.get()).toIls).toEqual({});
  });
});
