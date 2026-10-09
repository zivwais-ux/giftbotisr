import { describe, expect, it } from "vitest";
import { validateOutbound } from "../../src/conversation/messages.js";
import { ACTIONS } from "../../src/conversation/options.js";
import { DISCLOSURE, explain, PRICE_NOTICE, renderNoResults, renderProduct, renderResults } from "../../src/conversation/render.js";
import type { Recommendation } from "../../src/recommendation/engine.js";
import { makeProduct } from "../helpers.js";

function rec(overrides: Partial<Recommendation> = {}, productOverrides = {}): Recommendation {
  return {
    rank: 1,
    product: makeProduct(productOverrides),
    score: 0.9,
    components: { interests: 1, occasionAndRecipient: 1, budget: 1, delivery: 1, dataQuality: 1 },
    priceInBudgetCurrency: { amount: 200, currency: "ILS" },
    matchedInterests: ["coffee"],
    warnings: [],
    ...overrides,
  };
}

describe("renderProduct", () => {
  it("shows name, price, reason and link, with the image", () => {
    const msg = renderProduct(rec());
    expect(msg).toEqual({
      type: "product",
      imageUrl: "https://shop.test/p1.jpg",
      caption: [
        "*1. Test product*",
        "💰 200 ₪",
        "✨ מתאים למי שאוהב/ת קפה · מתאים במיוחד לאירוע ולמקבל/ת · בתוך התקציב · משלוח עד 3 ימים",
        "🛒 https://shop.test/p1",
      ].join("\n"),
    });
  });

  it("prefers the affiliate link when there is one", () => {
    const msg = renderProduct(rec({}, { affiliateUrl: "https://aff.test/x" }));
    expect(msg.type === "product" && msg.caption).toContain("🛒 https://aff.test/x");
  });

  it("states converted prices and unverified data honestly", () => {
    const msg = renderProduct(
      rec(
        {
          priceInBudgetCurrency: { amount: 320, currency: "ILS" },
          warnings: [
            "sample_data",
            "price_converted",
            "over_budget",
            "availability_unknown",
            "price_not_recently_verified",
            "international_shipping",
            "delivery_time_unknown",
          ],
        },
        { price: { amount: 80, currency: "USD" }, shipping: undefined },
      ),
    );
    const caption = msg.type === "product" ? msg.caption : "";
    expect(caption).toContain("💰 320 ₪ (בערך — המחיר המקורי $80)");
    expect(caption).toContain("מעט מעל התקציב");
    expect(caption).toContain("⚠️ מוצר לדוגמה — לא מוצר אמיתי");
    expect(caption).toContain("ℹ️ הזמינות לא אומתה");
    expect(caption).toContain("ℹ️ המחיר לא אומת בימים האחרונים");
    expect(caption).toContain("✈️ משלוח מחו״ל");
    expect(caption).toContain("ℹ️ זמן המשלוח לא ידוע");
  });

  it("keeps very long products within the caption limit without cutting the link or notes", () => {
    const msg = renderProduct(rec({ warnings: ["sample_data"] }, { name: "שם ארוך ".repeat(300) }));
    expect(validateOutbound(msg)).toEqual([]);
    const caption = msg.type === "product" ? msg.caption : "";
    expect(caption).toContain("🛒 https://shop.test/p1");
    expect(caption).toContain("⚠️ מוצר לדוגמה");
  });
});

describe("explain", () => {
  it("never claims matches the engine didn't find", () => {
    const text = explain(
      rec({ matchedInterests: [], components: { interests: 0.5, occasionAndRecipient: 0.6, budget: 1, delivery: 1, dataQuality: 1 } }, { shipping: undefined }),
    );
    expect(text).toBe("בתוך התקציב");
  });
});

describe("renderResults", () => {
  it("adds the affiliate disclosure only when an affiliate link is shown", () => {
    const withAff = renderResults([rec({}, { affiliateUrl: "https://aff.test/x" })], "initial", [ACTIONS.more]);
    const without = renderResults([rec()], "initial", [ACTIONS.more]);
    const footerBody = (m: typeof withAff) => (m.at(-1) as Extract<(typeof m)[number], { type: "buttons" }>).body;
    expect(footerBody(withAff)).toContain(DISCLOSURE);
    expect(footerBody(without)).not.toContain(DISCLOSURE);
    expect(footerBody(without)).toContain(PRICE_NOTICE);
  });

  it("produces only valid messages", () => {
    const messages = renderResults([1, 2, 3, 4, 5].map((rank) => rec({ rank })), "more", [ACTIONS.more, ACTIONS.cheaper, ACTIONS.restart]);
    expect(messages).toHaveLength(7);
    for (const m of messages) expect(validateOutbound(m)).toEqual([]);
  });
});

describe("renderNoResults", () => {
  it("offers the suggested fixes plus restart", () => {
    const [msg] = renderNoResults({ mode: "initial", suggestions: [ACTIONS.raiseBudget], catalogEmpty: false });
    expect(msg).toMatchObject({ type: "buttons", buttons: [ACTIONS.raiseBudget, ACTIONS.restart] });
  });

  it("is honest when the catalog is empty", () => {
    const [msg] = renderNoResults({ mode: "initial", suggestions: [], catalogEmpty: true });
    expect(msg?.type === "buttons" && msg.body).toContain("עדיין בבנייה");
  });
});
