import type { ExchangeRates } from "../domain/money.js";
import type { GiftRequest } from "../domain/types.js";

export interface ScoreWeights {
  interests: number;
  occasionAndRecipient: number;
  budget: number;
  delivery: number;
  dataQuality: number;
}

/** Initial weights from the product spec; tune after real user testing. */
export const DEFAULT_WEIGHTS: Readonly<ScoreWeights> = Object.freeze({
  interests: 0.3,
  occasionAndRecipient: 0.25,
  budget: 0.2,
  delivery: 0.15,
  dataQuality: 0.1,
});

export interface EngineOptions {
  /** Maximum recommendations returned. */
  maxResults: number;
  /** Fraction over budget.max (and under budget.min) still allowed, e.g. 0.1 = 10%. */
  budgetTolerance: number;
  /** Products scoring below this are not shown — better 2 good results than 5 weak ones. */
  minScore: number;
  /**
   * When the user named interests, only show products matching at least one of them.
   * The conversation layer may turn this off for an explicit "general ideas" fallback.
   */
  requireInterestMatch: boolean;
  /** Data verified within this many days counts as fresh. */
  freshDataDays: number;
  /** Data older than this is excluded entirely. */
  maxDataAgeDays: number;
  /** Soft cap on results sharing the same primary category (first category). */
  maxPerCategory: number;
  /** Sample/demo products are excluded unless this is explicitly true. */
  allowSampleProducts: boolean;
  weights: ScoreWeights;
}

export const DEFAULT_OPTIONS: Readonly<EngineOptions> = Object.freeze({
  maxResults: 5,
  budgetTolerance: 0.1,
  minScore: 0.6,
  requireInterestMatch: true,
  freshDataDays: 7,
  maxDataAgeDays: 90,
  maxPerCategory: 2,
  allowSampleProducts: false,
  weights: DEFAULT_WEIGHTS,
});

export interface EngineContext {
  request: GiftRequest;
  now: Date;
  exchangeRates: ExchangeRates;
  options: EngineOptions;
}

export function resolveOptions(overrides: Partial<EngineOptions> = {}): EngineOptions {
  const options: EngineOptions = {
    ...DEFAULT_OPTIONS,
    ...overrides,
    weights: { ...DEFAULT_WEIGHTS, ...overrides.weights },
  };
  validateOptions(options);
  return options;
}

function validateOptions(o: EngineOptions): void {
  const fail = (msg: string): never => {
    throw new Error(`Invalid engine options: ${msg}`);
  };
  if (!Number.isInteger(o.maxResults) || o.maxResults < 1) fail("maxResults must be a positive integer");
  if (!(o.budgetTolerance >= 0 && o.budgetTolerance < 1)) fail("budgetTolerance must be in [0, 1)");
  if (!(o.minScore >= 0 && o.minScore <= 1)) fail("minScore must be in [0, 1]");
  if (!(o.freshDataDays > 0)) fail("freshDataDays must be > 0");
  if (!(o.maxDataAgeDays >= o.freshDataDays)) fail("maxDataAgeDays must be >= freshDataDays");
  if (!Number.isInteger(o.maxPerCategory) || o.maxPerCategory < 1) fail("maxPerCategory must be a positive integer");

  const weights = Object.values(o.weights);
  if (weights.some((w) => !(w >= 0))) fail("weights must be non-negative");
  const sum = weights.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-6) fail(`weights must sum to 1 (got ${sum})`);
}
