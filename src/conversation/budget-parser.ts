export interface ParsedBudget {
  min?: number;
  max: number;
}

/** Budgets outside this range are treated as typos and re-asked. */
export const MIN_BUDGET = 10;
export const MAX_BUDGET = 100_000;

/**
 * Parses a typed budget in ILS. Understands e.g. "300", "עד 300", "300 ש״ח", "₪300", "1,500",
 * "200-300", "בין 200 ל-300", "200 עד 300". Returns undefined when unclear,
 * so the bot asks again instead of guessing.
 */
export function parseBudget(text: string): ParsedBudget | undefined {
  // "1,500" → "1500" (thousands separators only)
  const cleaned = text.replace(/(\d),(?=\d{3}\b)/g, "$1");
  if (/(מעל|יותר מ|לפחות|מינימום)/.test(cleaned)) return undefined; // a floor without a ceiling
  const numbers = [...cleaned.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (numbers.length === 0 || numbers.length > 2) return undefined;

  if (numbers.length === 1) {
    const max = numbers[0]!;
    return inRange(max) ? { max } : undefined;
  }
  const [a, b] = numbers as [number, number];
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  if (!inRange(max) || min < 0 || min === max) return min === max && inRange(max) ? { max } : undefined;
  return { min, max };
}

function inRange(n: number): boolean {
  return Number.isFinite(n) && n >= MIN_BUDGET && n <= MAX_BUDGET;
}
