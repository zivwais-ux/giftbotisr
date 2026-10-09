import { loadActiveProducts } from "../db/catalog-repository.js";
import type { Database } from "../db/database.js";
import { saveRecommendationSession } from "../db/recommendation-repository.js";
import type { ExchangeRates } from "../domain/money.js";
import type { GiftRequest } from "../domain/types.js";
import type { EngineOptions } from "../recommendation/context.js";
import { recommend, type RecommendationResult } from "../recommendation/engine.js";

export interface RecommendFromCatalogParams {
  request: GiftRequest;
  exchangeRates: ExchangeRates;
  now?: Date;
  options?: Partial<EngineOptions>;
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
 * run the engine, and persist the session and what was shown.
 */
export async function recommendFromCatalog(
  db: Database,
  params: RecommendFromCatalogParams,
): Promise<RecommendFromCatalogResult> {
  const includeSample = params.options?.allowSampleProducts === true;
  const catalog = await loadActiveProducts(db, { includeSample });

  const result = recommend({
    products: catalog.products,
    request: params.request,
    exchangeRates: params.exchangeRates,
    now: params.now ?? new Date(),
    options: params.options,
  });

  const saved = await saveRecommendationSession(db, {
    request: params.request,
    result,
    exchangeRates: params.exchangeRates,
    conversationId: params.conversationId,
    userId: params.userId,
  });

  return { ...saved, result, invalidProducts: catalog.invalid };
}
