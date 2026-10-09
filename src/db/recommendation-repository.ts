import type { ExchangeRates } from "../domain/money.js";
import type { GiftRequest } from "../domain/types.js";
import type { RecommendationResult } from "../recommendation/engine.js";
import { countExclusionReasons } from "../recommendation/stats.js";
import type { Database, Queryable } from "./database.js";

export interface SaveSessionParams {
  request: GiftRequest;
  result: RecommendationResult;
  exchangeRates: ExchangeRates;
  conversationId?: string;
  userId?: string;
}

export interface SavedSession {
  sessionId: string;
  /** Item ids in rank order — used later for click tracking links. */
  itemIds: string[];
}

/**
 * Stores a recommendation run: the request, how it was produced, aggregate exclusion stats,
 * and a snapshot of each item exactly as shown. One transaction — all or nothing.
 */
export async function saveRecommendationSession(db: Database, params: SaveSessionParams): Promise<SavedSession> {
  return db.transaction((tx) => insertRecommendationSession(tx, params));
}

/** Same as saveRecommendationSession, for callers already inside a transaction. */
export async function insertRecommendationSession(tx: Queryable, params: SaveSessionParams): Promise<SavedSession> {
  const { request, result } = params;
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.recommendation_sessions (
       conversation_id, user_id, recipient, occasion, budget_min, budget_max, budget_currency,
       interests, avoid, needed_by, delivery_country, allow_international_shipping,
       engine_version, engine_options, exchange_rates_as_of,
       evaluated_count, excluded_count, below_threshold_count, exclusion_stats, result_count
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     returning id`,
    [
      params.conversationId ?? null,
      params.userId ?? null,
      request.recipient,
      request.occasion,
      request.budget.min ?? null,
      request.budget.max,
      request.budget.currency,
      request.interests,
      request.avoid,
      request.neededBy ?? null,
      request.deliveryCountry,
      request.allowInternationalShipping,
      result.engineVersion,
      JSON.stringify(result.optionsUsed),
      params.exchangeRates.asOf,
      result.evaluatedCount,
      result.excluded.length,
      result.belowThreshold.length,
      JSON.stringify(countExclusionReasons(result)),
      result.recommendations.length,
    ],
  );
  const sessionId = rows[0]!.id;

  const itemIds: string[] = [];
  for (const rec of result.recommendations) {
    const item = await tx.query<{ id: string }>(
      `insert into public.recommendation_items (
         session_id, product_id, rank, score, score_components,
         shown_price_amount, shown_price_currency, matched_interests, warnings
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [
        sessionId,
        rec.product.id,
        rec.rank,
        rec.score,
        JSON.stringify(rec.components),
        rec.priceInBudgetCurrency.amount,
        rec.priceInBudgetCurrency.currency,
        rec.matchedInterests,
        rec.warnings,
      ],
    );
    itemIds.push(item.rows[0]!.id);
  }
  return { sessionId, itemIds };
}
