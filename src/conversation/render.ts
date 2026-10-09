import type { Currency } from "../domain/types.js";
import type { Recommendation, RecommendationWarning } from "../recommendation/engine.js";
import { LIMITS, truncate, type ChoiceOption, type OutboundMessage } from "./messages.js";
import { ACTIONS, INTEREST_OPTIONS, labelOf } from "./options.js";

const CURRENCY_SYMBOL: Record<Currency, string> = { ILS: "₪", USD: "$", EUR: "€", GBP: "£" };

export const DISCLOSURE =
  "ℹ️ חלק מהקישורים הם קישורי שותפים: אם תרכשו דרכם ייתכן שנקבל עמלה, ללא עלות נוספת עבורכם. העמלה לא משפיעה על סדר ההמלצות.";
export const PRICE_NOTICE = "המחירים והזמינות לפי המידע האחרון שבידינו — כדאי לוודא באתר לפני רכישה.";

const HEADERS = {
  initial: (n: number) => (n === 1 ? "מצאתי רעיון אחד שמתאים 🎁" : `מצאתי ${n} רעיונות שמתאימים 🎁`),
  more: (n: number) => (n === 1 ? "הנה עוד רעיון אחד:" : `הנה עוד ${n} רעיונות:`),
  cheaper: (n: number) => (n === 1 ? "מצאתי אפשרות אחת זולה יותר:" : `מצאתי ${n} אפשרויות זולות יותר:`),
} as const;

/** Notes shown under a product so unverified data is never presented as certain. */
const WARNING_TEXT: Partial<Record<RecommendationWarning, string>> = {
  sample_data: "⚠️ מוצר לדוגמה — לא מוצר אמיתי",
  availability_unknown: "ℹ️ הזמינות לא אומתה",
  price_not_recently_verified: "ℹ️ המחיר לא אומת בימים האחרונים",
  international_shipping: "✈️ משלוח מחו״ל",
  delivery_time_unknown: "ℹ️ זמן המשלוח לא ידוע",
};

export function renderResults(
  recommendations: Recommendation[],
  mode: keyof typeof HEADERS,
  actions: ChoiceOption[],
): OutboundMessage[] {
  const messages: OutboundMessage[] = [{ type: "text", body: HEADERS[mode](recommendations.length) }];
  for (const rec of recommendations) messages.push(renderProduct(rec));

  const footer = [PRICE_NOTICE];
  if (recommendations.some((r) => r.product.affiliateUrl)) footer.push(DISCLOSURE);
  footer.push("מה תרצו לעשות?");
  messages.push({ type: "buttons", body: footer.join("\n\n"), buttons: actions });
  return messages;
}

export function renderProduct(rec: Recommendation): OutboundMessage {
  const { product } = rec;
  const shown = rec.priceInBudgetCurrency;
  let priceLine = `💰 ${formatMoney(shown.amount, shown.currency)}`;
  if (rec.warnings.includes("price_converted")) {
    priceLine += ` (בערך — המחיר המקורי ${formatMoney(product.price.amount, product.price.currency)})`;
  }

  const notes = rec.warnings.map((w) => WARNING_TEXT[w]).filter((n): n is string => Boolean(n));
  const link = `🛒 ${product.affiliateUrl ?? product.productUrl}`;
  const head = [`*${rec.rank}. ${product.name}*`, priceLine, `✨ ${explain(rec)}`];
  const tail = [link, ...notes];

  // Keep the caption within the limit by shortening the name/explanation, never the link or notes.
  let caption = [...head, ...tail].join("\n");
  if ([...caption].length > LIMITS.caption) {
    const room = LIMITS.caption - [...tail.join("\n")].length - 1;
    caption = `${truncate(head.join("\n"), room)}\n${tail.join("\n")}`;
  }
  return { type: "product", caption, imageUrl: product.imageUrl };
}

/** A short, factual "why it fits" built only from data the engine actually matched. */
export function explain(rec: Recommendation): string {
  const reasons: string[] = [];
  const interests = rec.matchedInterests.map((t) => labelOf(INTEREST_OPTIONS, t) ?? t);
  if (interests.length > 0) reasons.push(`מתאים למי שאוהב/ת ${interests.join(" ו")}`);
  if (rec.components.occasionAndRecipient === 1) reasons.push("מתאים במיוחד לאירוע ולמקבל/ת");
  if (rec.warnings.includes("over_budget")) reasons.push("מעט מעל התקציב");
  else reasons.push("בתוך התקציב");
  const maxDays = rec.product.shipping?.maxDays;
  if (maxDays !== undefined) reasons.push(`משלוח עד ${maxDays} ימים`);
  return reasons.join(" · ");
}

export function renderNoResults(params: {
  mode: "initial" | "more" | "cheaper";
  suggestions: ChoiceOption[];
  catalogEmpty: boolean;
}): OutboundMessage[] {
  if (params.catalogEmpty) {
    return [
      { type: "buttons", body: "מאגר המתנות שלנו עדיין בבנייה, ולא מצאתי כרגע אפשרויות 🙏", buttons: [ACTIONS.restart] },
    ];
  }
  const body =
    params.mode === "initial"
      ? "לא מצאתי מתנה שמתאימה לכל מה שביקשתם 😕\nלא אציע משהו שלא באמת מתאים — אבל אפשר לנסות לשנות כיוון:"
      : "לא מצאתי עוד אפשרויות מתאימות 😕";
  return [{ type: "buttons", body, buttons: [...params.suggestions, ACTIONS.restart] }];
}

function formatMoney(amount: number, currency: Currency): string {
  const value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return currency === "ILS" ? `${value} ₪` : `${CURRENCY_SYMBOL[currency]}${value}`;
}
