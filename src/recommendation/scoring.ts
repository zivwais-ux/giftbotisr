import type { Product } from "../domain/types.js";
import type { EngineContext, ScoreWeights } from "./context.js";

/** Each component is in [0, 1]. */
export type ScoreComponents = ScoreWeights;

export interface ScoreFacts {
  convertedPrice: number;
  ageDays: number;
  isDomestic: boolean;
  daysAvailable: number | undefined;
}

export interface ScoreResult {
  score: number;
  components: ScoreComponents;
  matchedInterests: string[];
}

/** Score given when the user stated no interests: neither rewards nor penalizes any product. */
const NEUTRAL = 0.5;
/** An explicit occasion/recipient match beats a generic "any" product. */
const GENERIC_MATCH = 0.6;
/** A gift usually targets one or two interests; matching this many counts as a full match. */
const INTERESTS_FOR_FULL_MATCH = 2;

/**
 * Computes the weighted relevance score. Note what is NOT an input here:
 * affiliate commission. Relevance must stay independent of revenue.
 */
export function scoreProduct(product: Product, facts: ScoreFacts, ctx: EngineContext): ScoreResult {
  const { interests, matched } = interestScore(product, ctx.request.interests);
  const components: ScoreComponents = {
    interests,
    occasionAndRecipient: occasionAndRecipientScore(product, ctx),
    budget: budgetScore(facts.convertedPrice, ctx),
    delivery: deliveryScore(product, facts),
    dataQuality: dataQualityScore(product, facts.ageDays, ctx),
  };

  const w = ctx.options.weights;
  const score =
    components.interests * w.interests +
    components.occasionAndRecipient * w.occasionAndRecipient +
    components.budget * w.budget +
    components.delivery * w.delivery +
    components.dataQuality * w.dataQuality;

  const rounded: ScoreComponents = {
    interests: round4(components.interests),
    occasionAndRecipient: round4(components.occasionAndRecipient),
    budget: round4(components.budget),
    delivery: round4(components.delivery),
    dataQuality: round4(components.dataQuality),
  };
  return { score: round4(score), components: rounded, matchedInterests: matched };
}

export function interestScore(
  product: Product,
  requested: readonly string[],
): { interests: number; matched: string[] } {
  if (requested.length === 0) return { interests: NEUTRAL, matched: [] };
  const productTags = new Set([...product.interests, ...product.categories]);
  const matched = [...new Set(requested)].filter((tag) => productTags.has(tag));
  const needed = Math.min(new Set(requested).size, INTERESTS_FOR_FULL_MATCH);
  return { interests: Math.min(1, matched.length / needed), matched };
}

/** Hard filters already guarantee a match, so "not explicit" means the product is tagged "any". */
function occasionAndRecipientScore(product: Product, ctx: EngineContext): number {
  const occasion = product.occasions.includes(ctx.request.occasion) ? 1 : GENERIC_MATCH;
  const recipient = product.recipients.includes(ctx.request.recipient) ? 1 : GENERIC_MATCH;
  return (occasion + recipient) / 2;
}

/**
 * Gifts using a meaningful part of the budget score best; very cheap items score lower
 * (they may feel like an afterthought) and items slightly over budget lose points gradually.
 */
export function budgetScore(price: number, ctx: EngineContext): number {
  const { min, max } = ctx.request.budget;
  const tolerance = ctx.options.budgetTolerance;
  if (price > max) {
    if (tolerance === 0) return 0;
    const overFraction = (price / max - 1) / tolerance; // 0 at max, 1 at the tolerance limit
    return clamp01(1 - 0.5 * overFraction);
  }
  if (min !== undefined) {
    if (price >= min) return 1;
    // Under min but within tolerance (passed the filter).
    return 0.7;
  }
  const ratio = price / max;
  if (ratio >= 0.6) return 1;
  return clamp01(0.4 + ratio); // 0.4 for nearly free, 1.0 at 60% of budget
}

export function deliveryScore(product: Product, facts: ScoreFacts): number {
  const maxDays = product.shipping?.maxDays ?? product.shipping?.minDays;
  const internationalFactor = facts.isDomestic ? 1 : 0.9; // customs, returns and tracking risk
  let base: number;
  if (facts.daysAvailable === undefined) {
    base = maxDays !== undefined ? 1 : 0.6;
  } else if (maxDays === undefined) {
    base = 0.3; // there is a deadline and we can't tell if it will be met
  } else {
    const slackDays = facts.daysAvailable - maxDays;
    base = slackDays >= 2 ? 1 : 0.75;
  }
  return clamp01(base * internationalFactor);
}

export function dataQualityScore(product: Product, ageDays: number, ctx: EngineContext): number {
  const { freshDataDays, maxDataAgeDays } = ctx.options;
  let freshness: number;
  if (ageDays <= freshDataDays) freshness = 1;
  else freshness = 1 - 0.6 * ((ageDays - freshDataDays) / (maxDataAgeDays - freshDataDays)); // down to 0.4
  const availability = product.availability === "in_stock" ? 1 : 0.6;
  const imagePenalty = product.imageUrl ? 0 : 0.1;
  return clamp01(freshness * availability - imagePenalty);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
