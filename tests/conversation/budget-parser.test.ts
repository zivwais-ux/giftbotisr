import { describe, expect, it } from "vitest";
import { parseBudget } from "../../src/conversation/budget-parser.js";

describe("parseBudget", () => {
  it.each([
    ["300", { max: 300 }],
    ["עד 300", { max: 300 }],
    ["300 ש״ח", { max: 300 }],
    ['300 ש"ח', { max: 300 }],
    ["₪300", { max: 300 }],
    ["בערך 250 שקל", { max: 250 }],
    ["1,500", { max: 1500 }],
    ["99.90", { max: 99.9 }],
    ["200-300", { min: 200, max: 300 }],
    ["בין 200 ל-300", { min: 200, max: 300 }],
    ["300 עד 200", { min: 200, max: 300 }],
    ["300-300", { max: 300 }],
  ])("parses %j", (input, expected) => {
    expect(parseBudget(input)).toEqual(expected);
  });

  it.each([
    ["no number", "לא יודע"],
    ["floor only", "מעל 200"],
    ["at least", "לפחות 100"],
    ["too small (typo)", "5"],
    ["absurdly large", "5000000"],
    ["three numbers", "100 200 300"],
    ["empty", ""],
  ])("rejects %s", (_label, input) => {
    expect(parseBudget(input)).toBeUndefined();
  });
});
