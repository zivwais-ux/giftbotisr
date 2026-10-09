import type { RecommendationResult } from "./engine.js";

/** E.g. { over_budget: 12, occasion_mismatch: 4 } — shows where the catalog falls short. */
export function countExclusionReasons(result: RecommendationResult): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { reasons } of result.excluded) {
    for (const reason of reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  }
  for (const { reason } of result.belowThreshold) counts[reason] = (counts[reason] ?? 0) + 1;
  return counts;
}
