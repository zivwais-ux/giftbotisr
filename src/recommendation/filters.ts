import { convert } from "../domain/money.js";
import { ANY, type Product } from "../domain/types.js";
import type { EngineContext } from "./context.js";

export type ExclusionReason =
  | "sample_data_not_allowed"
  | "invalid_product_data"
  | "out_of_stock"
  | "data_too_stale"
  | "currency_conversion_unavailable"
  | "over_budget"
  | "under_budget"
  | "occasion_mismatch"
  | "recipient_mismatch"
  | "matches_avoid_list"
  | "international_shipping_not_allowed"
  | "does_not_ship_to_country"
  | "shipping_to_country_unknown"
  | "deadline_passed"
  | "delivery_too_slow";

export type FilterOutcome =
  | {
      passed: true;
      /** Price converted to the request's budget currency. */
      convertedPrice: number;
      ageDays: number;
      isDomestic: boolean;
      /** Calendar days until the deadline, when the request has one. */
      daysAvailable: number | undefined;
    }
  | { passed: false; reasons: ExclusionReason[] };

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Allowed clock skew for "lastVerifiedAt" timestamps slightly in the future. */
const FUTURE_TOLERANCE_MS = DAY_MS;

/**
 * Applies the hard filters. All failing reasons are collected (not just the first),
 * so exclusion stats can show exactly why the catalog failed a request.
 */
export function applyHardFilters(product: Product, ctx: EngineContext): FilterOutcome {
  const { request, now, options } = ctx;
  const reasons: ExclusionReason[] = [];

  if (product.isSample && !options.allowSampleProducts) reasons.push("sample_data_not_allowed");

  if (!isValidProductData(product, now)) reasons.push("invalid_product_data");

  if (product.availability === "out_of_stock") reasons.push("out_of_stock");

  const ageDays = Math.max(0, (now.getTime() - product.lastVerifiedAt.getTime()) / DAY_MS);
  if (ageDays > options.maxDataAgeDays) reasons.push("data_too_stale");

  // Budget
  const convertedPrice = convert(product.price, request.budget.currency, ctx.exchangeRates);
  if (convertedPrice === undefined) {
    reasons.push("currency_conversion_unavailable");
  } else {
    const { min, max } = request.budget;
    if (convertedPrice > max * (1 + options.budgetTolerance)) reasons.push("over_budget");
    if (min !== undefined && convertedPrice < min * (1 - options.budgetTolerance)) reasons.push("under_budget");
  }

  // Occasion & recipient
  if (!product.occasions.includes(request.occasion) && !product.occasions.includes(ANY)) {
    reasons.push("occasion_mismatch");
  }
  if (!product.recipients.includes(request.recipient) && !product.recipients.includes(ANY)) {
    reasons.push("recipient_mismatch");
  }

  if (matchesAvoidList(product, request.avoid)) reasons.push("matches_avoid_list");

  // Shipping & deadline
  const isDomestic = product.storeCountry === request.deliveryCountry;
  const shipsTo = product.shipping?.shipsTo ?? [];
  if (isDomestic) {
    if (shipsTo.length > 0 && !shipsTo.includes(request.deliveryCountry)) reasons.push("does_not_ship_to_country");
  } else {
    if (!request.allowInternationalShipping) reasons.push("international_shipping_not_allowed");
    if (shipsTo.length === 0) reasons.push("shipping_to_country_unknown");
    else if (!shipsTo.includes(request.deliveryCountry)) reasons.push("does_not_ship_to_country");
  }

  let daysAvailable: number | undefined;
  if (request.neededBy) {
    daysAvailable = (request.neededBy.getTime() - now.getTime()) / DAY_MS;
    if (daysAvailable < 0) {
      reasons.push("deadline_passed");
    } else {
      // Be conservative: use the worst-case estimate when we have one.
      const worstCaseDays = product.shipping?.maxDays ?? product.shipping?.minDays;
      if (worstCaseDays !== undefined && worstCaseDays > daysAvailable) reasons.push("delivery_too_slow");
    }
  }

  if (reasons.length > 0 || convertedPrice === undefined) return { passed: false, reasons };
  return { passed: true, convertedPrice, ageDays, isDomestic, daysAvailable };
}

/** Defensive runtime checks, for products that bypassed schema validation. */
function isValidProductData(product: Product, now: Date): boolean {
  if (!Number.isFinite(product.price.amount) || product.price.amount <= 0) return false;
  if (!product.productUrl.startsWith("https://")) return false;
  if (Number.isNaN(product.lastVerifiedAt.getTime())) return false;
  if (product.lastVerifiedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) return false;
  return true;
}

/** Single-letter Hebrew prefixes (the, and, in, to, from, that, as) that attach to words. */
const HEBREW_PREFIXES = new Set(["ה", "ו", "ב", "ל", "מ", "ש", "כ"]);

/**
 * True if any avoid term matches a product tag exactly, or appears as a whole word/phrase
 * in the product name or description. Errs on the side of excluding: a false positive only
 * hides one product, a false negative recommends something the user asked to avoid.
 */
export function matchesAvoidList(product: Product, avoid: readonly string[]): boolean {
  if (avoid.length === 0) return false;
  const tags = new Set([...product.categories, ...product.interests]);
  const words = tokenize(`${product.name} ${product.description}`);
  const wordSet = new Set(words);
  for (const word of words) {
    const first = word.charAt(0);
    if (word.length > 2 && HEBREW_PREFIXES.has(first)) wordSet.add(word.slice(1));
  }
  const joined = ` ${words.join(" ")} `;

  return avoid.some((term) => {
    if (tags.has(term)) return true;
    const termWords = tokenize(term);
    if (termWords.length === 0) return false;
    if (termWords.length === 1) return wordSet.has(termWords[0]!);
    return joined.includes(` ${termWords.join(" ")} `);
  });
}

function tokenize(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}
