import type { ExchangeRates } from "../domain/money.js";
import type { Currency, GiftRequest, Product } from "../domain/types.js";
import { resolveOptions, type EngineContext, type EngineOptions } from "./context.js";
import { applyHardFilters, type ExclusionReason } from "./filters.js";
import { scoreProduct, type ScoreComponents } from "./scoring.js";

/** Bump when filter/scoring behavior changes, so stored results can be traced to the logic that produced them. */
export const ENGINE_VERSION = "1.0.0";

/** Facts the user must be told about, so we never present unverified data as certain. */
export type RecommendationWarning =
  | "sample_data"
  | "availability_unknown"
  | "price_not_recently_verified"
  | "price_converted"
  | "over_budget"
  | "under_budget"
  | "international_shipping"
  | "delivery_time_unknown"
  | "no_image";

export type RelevanceRejection = "below_min_score" | "no_interest_match";

export interface Recommendation {
  rank: number;
  product: Product;
  score: number;
  components: ScoreComponents;
  /** Price in the request's budget currency (approximate when converted). */
  priceInBudgetCurrency: { amount: number; currency: Currency };
  matchedInterests: string[];
  warnings: RecommendationWarning[];
}

export interface RecommendationResult {
  recommendations: Recommendation[];
  /** Products removed by hard filters, with every reason. Useful for finding catalog gaps. */
  excluded: { productId: string; reasons: ExclusionReason[] }[];
  /** Products that passed the hard filters but were judged not relevant enough to show. */
  belowThreshold: { productId: string; score: number; reason: RelevanceRejection }[];
  evaluatedCount: number;
  engineVersion: string;
  /** The fully resolved options used for this run. */
  optionsUsed: EngineOptions;
}

export interface RecommendParams {
  products: readonly Product[];
  request: GiftRequest;
  exchangeRates: ExchangeRates;
  /** Injected for deterministic behavior and testing. */
  now: Date;
  options?: Partial<EngineOptions>;
}

interface Candidate {
  product: Product;
  score: number;
  components: ScoreComponents;
  convertedPrice: number;
  matchedInterests: string[];
  warnings: RecommendationWarning[];
}

/**
 * Recommends gifts from a catalog: hard filters first, then weighted ranking,
 * then a relevance threshold and a soft diversity rule. Pure function — no I/O.
 */
export function recommend(params: RecommendParams): RecommendationResult {
  const options = resolveOptions(params.options);
  const ctx: EngineContext = {
    request: params.request,
    now: params.now,
    exchangeRates: params.exchangeRates,
    options,
  };

  const excluded: RecommendationResult["excluded"] = [];
  const belowThreshold: RecommendationResult["belowThreshold"] = [];
  const candidates: Candidate[] = [];

  for (const product of params.products) {
    const outcome = applyHardFilters(product, ctx);
    if (!outcome.passed) {
      excluded.push({ productId: product.id, reasons: outcome.reasons });
      continue;
    }
    const { score, components, matchedInterests } = scoreProduct(product, outcome, ctx);
    if (options.requireInterestMatch && params.request.interests.length > 0 && matchedInterests.length === 0) {
      belowThreshold.push({ productId: product.id, score, reason: "no_interest_match" });
      continue;
    }
    if (score < options.minScore) {
      belowThreshold.push({ productId: product.id, score, reason: "below_min_score" });
      continue;
    }
    candidates.push({
      product,
      score,
      components,
      convertedPrice: outcome.convertedPrice,
      matchedInterests,
      warnings: collectWarnings(product, outcome, ctx),
    });
  }

  candidates.sort(compareCandidates);
  const selected = selectDiverse(candidates, options.maxResults, options.maxPerCategory);

  return {
    recommendations: selected.map((c, i) => ({
      rank: i + 1,
      product: c.product,
      score: c.score,
      components: c.components,
      priceInBudgetCurrency: { amount: c.convertedPrice, currency: ctx.request.budget.currency },
      matchedInterests: c.matchedInterests,
      warnings: c.warnings,
    })),
    excluded,
    belowThreshold,
    evaluatedCount: params.products.length,
    engineVersion: ENGINE_VERSION,
    optionsUsed: options,
  };
}

/** Higher score first; ties broken by lower price, then id, so ordering is fully deterministic. */
function compareCandidates(a: Candidate, b: Candidate): number {
  return b.score - a.score || a.convertedPrice - b.convertedPrice || a.product.id.localeCompare(b.product.id);
}

/**
 * Picks top candidates while limiting how many share a primary category.
 * The cap is soft: if there aren't enough diverse items, the best remaining ones fill the list,
 * because a relevant repeat is better than showing fewer results than we could.
 */
function selectDiverse(sorted: readonly Candidate[], maxResults: number, maxPerCategory: number): Candidate[] {
  const selected: Candidate[] = [];
  const deferred: Candidate[] = [];
  const perCategory = new Map<string, number>();

  for (const c of sorted) {
    if (selected.length >= maxResults) break;
    const category = c.product.categories[0]!;
    const count = perCategory.get(category) ?? 0;
    if (count < maxPerCategory) {
      selected.push(c);
      perCategory.set(category, count + 1);
    } else {
      deferred.push(c);
    }
  }
  for (const c of deferred) {
    if (selected.length >= maxResults) break;
    selected.push(c);
  }
  return selected.sort(compareCandidates);
}

function collectWarnings(
  product: Product,
  facts: { convertedPrice: number; ageDays: number; isDomestic: boolean },
  ctx: EngineContext,
): RecommendationWarning[] {
  const warnings: RecommendationWarning[] = [];
  const { budget } = ctx.request;
  if (product.isSample) warnings.push("sample_data");
  if (product.availability === "unknown") warnings.push("availability_unknown");
  if (facts.ageDays > ctx.options.freshDataDays) warnings.push("price_not_recently_verified");
  if (product.price.currency !== budget.currency) warnings.push("price_converted");
  if (facts.convertedPrice > budget.max) warnings.push("over_budget");
  if (budget.min !== undefined && facts.convertedPrice < budget.min) warnings.push("under_budget");
  if (!facts.isDomestic) warnings.push("international_shipping");
  if (product.shipping?.maxDays === undefined && product.shipping?.minDays === undefined) {
    warnings.push("delivery_time_unknown");
  }
  if (!product.imageUrl) warnings.push("no_image");
  return warnings;
}
