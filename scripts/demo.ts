/**
 * Runs the recommendation engine against the SAMPLE catalog and prints the results.
 * Usage: npm run demo
 * All products here are fictional sample data — not real products, prices or links.
 */
import { SAMPLE_EXCHANGE_RATES, SAMPLE_PRODUCTS, SAMPLE_REFERENCE_DATE } from "../src/data/sample-products.js";
import { parseGiftRequest, type GiftRequestInput } from "../src/domain/types.js";
import { recommend } from "../src/recommendation/index.js";

const scenarios: { title: string; request: GiftRequestInput }[] = [
  {
    title: "יום הולדת לבן/בת זוג שאוהב/ת קפה, עד 300 ₪",
    request: { recipient: "partner", occasion: "birthday", budget: { max: 300, currency: "ILS" }, interests: ["coffee"] },
  },
  {
    title: "יום הולדת לחבר שאוהב טיולים, עד 400 ₪, צריך תוך 7 ימים",
    request: {
      recipient: "friend",
      occasion: "birthday",
      budget: { max: 400, currency: "ILS" },
      interests: ["hiking"],
      neededBy: new Date(SAMPLE_REFERENCE_DATE.getTime() + 7 * 86_400_000),
    },
  },
  {
    title: "מתנת לידה, עד 200 ₪, בלי משלוח מחו\"ל",
    request: { recipient: "baby", occasion: "birth", budget: { max: 200, currency: "ILS" }, allowInternationalShipping: false },
  },
  {
    title: "חנוכת בית לקולגה, עד 250 ₪, בלי אלכוהול",
    request: { recipient: "colleague", occasion: "housewarming", budget: { max: 250, currency: "ILS" }, avoid: ["alcohol"] },
  },
];

console.log("⚠️  נתוני דוגמה בלבד — אלה אינם מוצרים, מחירים או קישורים אמיתיים.\n");

for (const { title, request } of scenarios) {
  const result = recommend({
    products: SAMPLE_PRODUCTS,
    request: parseGiftRequest(request),
    exchangeRates: SAMPLE_EXCHANGE_RATES,
    now: SAMPLE_REFERENCE_DATE,
    options: { allowSampleProducts: true },
  });

  console.log(`=== ${title} ===`);
  if (result.recommendations.length === 0) console.log("  (אין התאמות)");
  for (const r of result.recommendations) {
    const price = `${r.priceInBudgetCurrency.amount} ${r.priceInBudgetCurrency.currency}`;
    console.log(`  ${r.rank}. ${r.product.name} — ${price} — ציון ${r.score}`);
    if (r.matchedInterests.length) console.log(`     תחומי עניין תואמים: ${r.matchedInterests.join(", ")}`);
    if (r.warnings.length) console.log(`     הערות: ${r.warnings.join(", ")}`);
  }
  console.log(
    `  נבדקו ${result.evaluatedCount} | הוצגו ${result.recommendations.length} | ` +
      `סוננו ${result.excluded.length} | מתחת לסף ${result.belowThreshold.length}\n`,
  );
}
