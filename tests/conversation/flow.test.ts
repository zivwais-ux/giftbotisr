import { describe, expect, it } from "vitest";
import {
  afterRecommendation,
  buildRequest,
  handleInput,
  nextStep,
  startConversation,
  suggestFixes,
  TEXTS,
  type FlowOutput,
} from "../../src/conversation/flow.js";
import { validateOutbound, type InboundContent } from "../../src/conversation/messages.js";
import { ACTIONS } from "../../src/conversation/options.js";
import type { ConversationState } from "../../src/conversation/state.js";
import { recommend } from "../../src/recommendation/engine.js";
import { makeProduct, NOW, RATES } from "../helpers.js";

const tap = (id: string): InboundContent => ({ type: "choice", id });
const type = (text: string): InboundContent => ({ type: "text", text });

/** Feeds inputs in sequence, asserting every outgoing message is valid for WhatsApp. */
function play(inputs: InboundContent[], state: ConversationState = startConversation().state): FlowOutput {
  let out: FlowOutput = { state, messages: [] };
  for (const input of inputs) {
    out = handleInput(out.state, input, NOW);
    for (const m of out.messages) expect(validateOutbound(m)).toEqual([]);
  }
  return out;
}

const FULL_ANSWERS = [tap("r:friend"), tap("o:birthday"), tap("b:300"), tap("i:coffee"), tap("a:none"), tap("d:none"), tap("x:yes")];

function resultsState(): ConversationState {
  return { ...play(FULL_ANSWERS).state, shownProductIds: ["p1"], resultsShown: true };
}

describe("startConversation", () => {
  it("welcomes and asks who the gift is for", () => {
    const out = startConversation();
    expect(out.state.step).toBe("ask_recipient");
    expect(out.messages[0]).toEqual({ type: "text", body: TEXTS.welcome });
    expect(out.messages[1]).toMatchObject({ type: "list", body: "למי המתנה? 🎁" });
  });
});

describe("question order", () => {
  it("asks each question once, in order, then requests recommendations", () => {
    const steps: string[] = [];
    let state = startConversation().state;
    for (const input of FULL_ANSWERS) {
      steps.push(state.step);
      state = handleInput(state, input, NOW).state;
    }
    expect(steps).toEqual([
      "ask_recipient",
      "ask_occasion",
      "ask_budget",
      "ask_interests",
      "ask_avoid",
      "ask_deadline",
      "ask_international",
    ]);
    const out = play(FULL_ANSWERS);
    expect(out.effect).toEqual({
      type: "recommend",
      mode: "initial",
      request: buildRequest(out.state.answers),
      requireInterestMatch: true,
      excludeProductIds: [],
    });
    expect(out.effect?.type === "recommend" && out.effect.request).toMatchObject({
      recipient: "friend",
      occasion: "birthday",
      budget: { max: 300, currency: "ILS" },
      interests: ["coffee"],
      avoid: [],
      deliveryCountry: "IL",
      allowInternationalShipping: true,
    });
  });

  it("skips the interests question for a baby", () => {
    const out = play([tap("r:baby"), tap("o:birth"), tap("b:150")]);
    expect(out.state.step).toBe("ask_avoid");
    expect(out.state.answers.interests).toEqual([]);
  });

  it("skips the international question for an urgent deadline (and disallows it)", () => {
    const out = play(FULL_ANSWERS.slice(0, 5).concat(tap("d:3")));
    expect(out.effect?.type).toBe("recommend");
    expect(out.state.answers.allowInternational).toBe(false);
    expect(out.state.answers.neededBy).toBe(new Date(NOW.getTime() + 3 * 86_400_000).toISOString());
  });

  it("re-asks about international shipping if the user later relaxes an urgent deadline", () => {
    const urgent = play(FULL_ANSWERS.slice(0, 5).concat(tap("d:3")));
    const relaxed = handleInput(urgent.state, tap("d:none"), NOW);
    expect(relaxed.state.step).toBe("ask_international");
    expect(relaxed.effect).toBeUndefined();
  });

  it("records 'no preference' answers so they aren't asked again", () => {
    const out = play([tap("r:friend"), tap("o:birthday"), tap("b:300"), tap("i:none"), tap("a:none"), tap("d:none")]);
    expect(out.state.answers).toMatchObject({ interests: [], avoid: [], neededBy: null });
    expect(out.state.step).toBe("ask_international");
  });
});

describe("typed answers", () => {
  it("understands typed labels and aliases", () => {
    const out = play([type("חברה"), type("יום הולדת"), type("עד 250 ש״ח"), type("ספורט"), type("בלי אלכוהול"), type("לא דחוף"), type("כן")]);
    expect(out.state.answers).toMatchObject({
      recipient: "friend",
      occasion: "birthday",
      budget: { max: 250 },
      interests: ["fitness"],
      avoid: ["alcohol"],
      allowInternational: true,
    });
    expect(out.effect?.type).toBe("recommend");
  });

  it("parses budget ranges", () => {
    const out = play([tap("r:friend"), tap("o:birthday"), type("200-400")]);
    expect(out.state.answers.budget).toEqual({ min: 200, max: 400 });
  });

  it("re-asks politely on an unclear answer without changing state", () => {
    const before = play([tap("r:friend")]);
    const out = handleInput(before.state, type("משהו מוזר"), NOW);
    expect(out.state).toEqual(before.state);
    expect(out.messages[0]).toEqual({ type: "text", body: TEXTS.notUnderstood });
    expect(out.messages[1]).toMatchObject({ type: "list", body: "מה האירוע? 🎉" });
  });

  it("gives a budget-specific hint when the budget is unclear", () => {
    const before = play([tap("r:friend"), tap("o:birthday")]);
    expect(handleInput(before.state, type("לא יודע"), NOW).messages).toEqual([
      { type: "text", body: TEXTS.budgetNotUnderstood },
    ]);
  });

  it("explains that images/voice/etc. aren't supported yet and repeats the question", () => {
    const before = play([tap("r:friend")]);
    const out = handleInput(before.state, { type: "unsupported", kind: "audio" }, NOW);
    expect(out.state).toEqual(before.state);
    expect(out.messages[0]).toEqual({ type: "text", body: TEXTS.unsupported });
    expect(out.messages[1]).toMatchObject({ body: "מה האירוע? 🎉" });
  });

  it("ignores unknown button ids", () => {
    const before = play([tap("r:friend")]);
    const out = handleInput(before.state, tap("r:martian"), NOW);
    expect(out.state).toEqual(before.state);
    expect(out.messages[0]).toEqual({ type: "text", body: TEXTS.notUnderstood });
  });
});

describe("corrections", () => {
  it("lets the user change an earlier answer by tapping its old button", () => {
    const mid = play([tap("r:friend"), tap("o:birthday"), tap("b:300")]);
    const corrected = handleInput(mid.state, tap("r:parent"), NOW);
    expect(corrected.state.answers.recipient).toBe("parent");
    expect(corrected.state.step).toBe("ask_interests"); // continues where it was
  });

  it("re-runs the search from scratch when an answer changes after results", () => {
    const out = handleInput(resultsState(), tap("b:500"), NOW);
    expect(out.effect).toMatchObject({ type: "recommend", mode: "initial", excludeProductIds: [] });
    expect(out.state.answers.budget).toEqual({ max: 500 });
    expect(out.state.shownProductIds).toEqual([]);
  });
});

describe("commands", () => {
  it.each(["עזרה", "help", "?"])("'%s' shows help and repeats the current question", (cmd) => {
    const before = play([tap("r:friend")]);
    const out = handleInput(before.state, type(cmd), NOW);
    expect(out.state).toEqual(before.state);
    expect(out.messages[0]).toEqual({ type: "text", body: TEXTS.help });
    expect(out.messages[1]).toMatchObject({ body: "מה האירוע? 🎉" });
  });

  it.each(["התחל מחדש", "מחדש", "restart"])("'%s' restarts", (cmd) => {
    const out = handleInput(play([tap("r:friend"), tap("o:birthday")]).state, type(cmd), NOW);
    expect(out.effect).toEqual({ type: "restart" });
    expect(out.state).toEqual(startConversation().state);
  });

  it("the restart button restarts", () => {
    expect(handleInput(resultsState(), tap(ACTIONS.restart.id), NOW).effect).toEqual({ type: "restart" });
  });

  it.each(["הסר", "STOP", "עצור"])("'%s' stops", (cmd) => {
    const out = handleInput(play([tap("r:friend")]).state, type(cmd), NOW);
    expect(out.effect).toEqual({ type: "stop" });
    expect(out.messages).toEqual([{ type: "text", body: TEXTS.stopped }]);
  });
});

describe("post-results actions", () => {
  it("'more' excludes products already shown", () => {
    const out = handleInput(resultsState(), tap(ACTIONS.more.id), NOW);
    expect(out.effect).toMatchObject({ type: "recommend", mode: "more", excludeProductIds: ["p1"] });
  });

  it("'cheaper' lowers the budget by ~30% and excludes products already shown", () => {
    const out = handleInput(resultsState(), tap(ACTIONS.cheaper.id), NOW);
    expect(out.state.answers.budget).toEqual({ max: 210 });
    expect(out.effect).toMatchObject({ type: "recommend", mode: "cheaper", excludeProductIds: ["p1"] });
  });

  it("'raise budget', 'general ideas', 'no deadline' and 'international' relax one constraint", () => {
    const s = resultsState();
    expect(handleInput(s, tap(ACTIONS.raiseBudget.id), NOW).state.answers.budget).toEqual({ max: 450 });
    const general = handleInput(s, tap(ACTIONS.generalIdeas.id), NOW);
    expect(general.effect).toMatchObject({ requireInterestMatch: false });
    const noDeadline = handleInput({ ...s, answers: { ...s.answers, neededBy: NOW.toISOString(), deadline: "within_3_days" } }, tap(ACTIONS.noDeadline.id), NOW);
    expect(noDeadline.state.answers).toMatchObject({ neededBy: null, deadline: "no_rush" });
    const intl = handleInput({ ...s, answers: { ...s.answers, allowInternational: false } }, tap(ACTIONS.allowInternational.id), NOW);
    expect(intl.effect?.type === "recommend" && intl.effect.request.allowInternationalShipping).toBe(true);
  });

  it("ignores result actions before results exist", () => {
    const out = handleInput(play([tap("r:friend")]).state, tap(ACTIONS.more.id), NOW);
    expect(out.effect).toBeUndefined();
    expect(out.messages[0]).toEqual({ type: "text", body: TEXTS.notUnderstood });
  });

  it("answers free text after results with the action buttons", () => {
    const out = handleInput(resultsState(), type("תודה רבה"), NOW);
    expect(out.effect).toBeUndefined();
    expect(out.messages).toEqual([
      { type: "buttons", body: TEXTS.chooseAction, buttons: [ACTIONS.more, ACTIONS.cheaper, ACTIONS.restart] },
    ]);
  });
});

describe("afterRecommendation", () => {
  const state = play(FULL_ANSWERS).state;
  const run = (products = [makeProduct({ id: "a" }), makeProduct({ id: "b", categories: ["books"] })]) =>
    recommend({ products, request: buildRequest(state.answers), exchangeRates: RATES, now: NOW });

  it("renders results and remembers what was shown", () => {
    const out = afterRecommendation(state, { mode: "initial", result: run(), sessionId: "s1" });
    expect(out.state).toMatchObject({ step: "results", shownProductIds: ["a", "b"], resultsShown: true, lastSessionId: "s1" });
    expect(out.messages.filter((m) => m.type === "product")).toHaveLength(2);
    expect(out.messages.at(-1)).toMatchObject({ type: "buttons", buttons: [ACTIONS.more, ACTIONS.cheaper, ACTIONS.restart] });
  });

  it("suggests the fix matching the main reason for no results", () => {
    const result = run([makeProduct({ id: "pricey", price: { amount: 900, currency: "ILS" } })]);
    const out = afterRecommendation(state, { mode: "initial", result, sessionId: "s1" });
    expect(out.state.resultsShown).toBe(false);
    expect(out.messages[0]).toMatchObject({ type: "buttons", buttons: [ACTIONS.raiseBudget, ACTIONS.restart] });
  });
});

describe("suggestFixes", () => {
  const state = play(FULL_ANSWERS).state;

  it("ranks fixes by how many products they'd unlock and offers at most two", () => {
    const result = recommend({
      products: [
        makeProduct({ id: "p1", price: { amount: 900, currency: "ILS" } }),
        makeProduct({ id: "p2", interests: ["music"] }),
        makeProduct({ id: "p3", interests: ["music"] }),
      ],
      request: buildRequest(state.answers),
      exchangeRates: RATES,
      now: NOW,
    });
    expect(suggestFixes(state, result)).toEqual([ACTIONS.generalIdeas, ACTIONS.raiseBudget]);
  });

  it("doesn't suggest relaxing a constraint the user didn't set", () => {
    const result = recommend({
      products: [makeProduct({ storeCountry: "US", shipping: { shipsTo: ["IL"], maxDays: 30 } })],
      request: buildRequest(state.answers),
      exchangeRates: RATES,
      now: NOW,
    });
    expect(suggestFixes(state, result)).toEqual([]);
  });
});

describe("nextStep", () => {
  it("returns results only when every question is answered", () => {
    expect(nextStep({})).toBe("ask_recipient");
    expect(nextStep(play(FULL_ANSWERS).state.answers)).toBe("results");
  });
});
