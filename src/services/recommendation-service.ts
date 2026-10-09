import { loadActiveProducts } from "../db/catalog-repository.js";
import type { Database, Queryable } from "../db/database.js";
import { insertRecommendationSession } from "../db/recommendation-repository.js";
import type { ExchangeRates } from "../domain/money.js";
import type { GiftRequest } from "../domain/types.js";
import type { EngineOptions } from "../recommendation/context.js";
import { recommend, type RecommendationResult } from "../recommendation/engine.js";

export interface RecommendFromCatalogParams {
  request: GiftRequest;
  exchangeRates: ExchangeRates;
  now?: Date;
  options?: Partial<EngineOptions>;
  /** Products not to recommend again (e.g. already shown in this conversation). */
  excludeProductIds?: readonly string[];
  conversationId?: string;
  userId?: string;
}

export interface RecommendFromCatalogResult {
  sessionId: string;
  itemIds: string[];
  result: RecommendationResult;
  /** Catalog rows skipped because their stored data failed validation. */
  invalidProducts: { productId: string; issues: string[] }[];
}

/**
 * The full recommendation flow against the database: load the eligible catalog,
 * run the engine, and persist the session and what was shown — atomically.
 */
export async function recommendFromCatalog(
  db: Database,
  params: RecommendFromCatalogParams,
): Promise<RecommendFromCatalogResult> {
  return db.transaction((tx) => runRecommendation(tx, params));
}

/** Same as recommendFromCatalog, for callers already inside a transaction. */
export async function runRecommendation(
  tx: Queryable,
  params: RecommendFromCatalogParams,
): Promise<RecommendFromCatalogResult> {
  const includeSample = params.options?.allowSampleProducts === true;
  const catalog = await loadActiveProducts(tx, { includeSample });
  const exclude = new Set(params.excludeProductIds ?? []);

  const result = recommend({
    products: catalog.products.filter((p) => !exclude.has(p.id)),
    request: params.request,
    exchangeRates: params.exchangeRates,
    now: params.now ?? new Date(),
    options: params.options,
  });

  const saved = await insertRecommendationSession(tx, {
    request: params.request,
    result,
    exchangeRates: params.exchangeRates,
    conversationId: params.conversationId,
    userId: params.userId,
  });

  return { ...saved, result, invalidProducts: catalog.invalid };
}
