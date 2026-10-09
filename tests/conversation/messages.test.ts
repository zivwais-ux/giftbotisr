import { describe, expect, it } from "vitest";
import { truncate, validateOutbound } from "../../src/conversation/messages.js";
import {
  ACTIONS,
  AVOID_OPTIONS,
  BUDGET_OPTIONS,
  DEADLINE_OPTIONS,
  INTEREST_OPTIONS,
  INTERNATIONAL_OPTIONS,
  matchOption,
  OCCASION_OPTIONS,
  type AnswerOption,
  RECIPIENT_OPTIONS,
} from "../../src/conversation/options.js";

describe("validateOutbound", () => {
  it("accepts valid messages", () => {
    expect(validateOutbound({ type: "text", body: "hi" })).toEqual([]);
    expect(validateOutbound({ type: "buttons", body: "b", buttons: [{ id: "a", title: "A" }] })).toEqual([]);
  });

  it("flags WhatsApp limit violations", () => {
    expect(validateOutbound({ type: "text", body: "" })).not.toEqual([]);
    expect(validateOutbound({ type: "text", body: "x".repeat(4097) })).not.toEqual([]);
    const four = [1, 2, 3, 4].map((i) => ({ id: `b${i}`, title: `B${i}` }));
    expect(validateOutbound({ type: "buttons", body: "b", buttons: four })).not.toEqual([]);
    expect(
      validateOutbound({ type: "buttons", body: "b", buttons: [{ id: "a", title: "x".repeat(21) }] }),
    ).not.toEqual([]);
    expect(
      validateOutbound({ type: "buttons", body: "b", buttons: [{ id: "a", title: "A" }, { id: "a", title: "B" }] }),
    ).not.toEqual([]);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ id: `r${i}`, title: `R${i}` }));
    expect(validateOutbound({ type: "list", body: "b", buttonLabel: "x", options: eleven })).not.toEqual([]);
    expect(validateOutbound({ type: "product", caption: "x".repeat(1025) })).not.toEqual([]);
  });

  it("counts emoji and Hebrew by character, not bytes", () => {
    expect(validateOutbound({ type: "buttons", body: "b", buttons: [{ id: "a", title: "🎁".repeat(20) }] })).toEqual([]);
  });
});

describe("answer options", () => {
  const all: AnswerOption<unknown>[][] = [RECIPIENT_OPTIONS, OCCASION_OPTIONS, INTEREST_OPTIONS, AVOID_OPTIONS, DEADLINE_OPTIONS, INTERNATIONAL_OPTIONS];

  it("fit WhatsApp list/button limits", () => {
    for (const options of all) {
      expect(options.length).toBeLessThanOrEqual(10);
      for (const o of options) expect([...o.title].length).toBeLessThanOrEqual(24);
    }
    for (const o of [...BUDGET_OPTIONS, ...DEADLINE_OPTIONS, ...INTERNATIONAL_OPTIONS, ...Object.values(ACTIONS)]) {
      expect([...o.title].length).toBeLessThanOrEqual(20);
    }
  });

  it("have globally unique ids", () => {
    const ids = [...all.flat(), ...BUDGET_OPTIONS, ...Object.values(ACTIONS)].map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("have no alias that matches two options of the same question", () => {
    for (const options of all) {
      for (const o of options) {
        for (const alias of [o.title, ...(o.aliases ?? [])]) {
          expect(matchOption(options, { text: alias })?.id).toBe(o.id);
        }
      }
    }
  });

  it("match typed answers loosely (case, punctuation, spacing)", () => {
    expect(matchOption(RECIPIENT_OPTIONS, { text: "  חבר!! " })?.value).toBe("friend");
    expect(matchOption(OCCASION_OPTIONS, { text: "יום   הולדת 🎂" })?.value).toBe("birthday");
    expect(matchOption(RECIPIENT_OPTIONS, { text: "מישהו מהשכונה" })).toBeUndefined();
  });
});

describe("truncate", () => {
  it("cuts by character and adds an ellipsis", () => {
    expect(truncate("שלום עולם", 5)).toBe("שלום…");
    expect(truncate("קצר", 5)).toBe("קצר");
  });
});
