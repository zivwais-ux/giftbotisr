import { parseGiftRequest, type GiftRequest } from "../domain/types.js";
import type { RecommendationResult } from "../recommendation/engine.js";
import { countExclusionReasons } from "../recommendation/stats.js";
import { parseBudget } from "./budget-parser.js";
import type { ChoiceOption, InboundContent, OutboundMessage } from "./messages.js";
import {
  ACTIONS,
  AVOID_OPTIONS,
  BUDGET_OPTIONS,
  COMMAND_WORDS,
  DEADLINE_DAYS,
  DEADLINE_OPTIONS,
  INTEREST_OPTIONS,
  INTERNATIONAL_OPTIONS,
  matchOption,
  normalizeText,
  OCCASION_OPTIONS,
  RECIPIENT_OPTIONS,
  toChoices,
} from "./options.js";
import { renderNoResults, renderResults } from "./render.js";
import { initialState, type Answers, type ConversationState, type Step } from "./state.js";

export type RecommendMode = "initial" | "more" | "cheaper";

export type FlowEffect =
  | {
      type: "recommend";
      mode: RecommendMode;
      request: GiftRequest;
      requireInterestMatch: boolean;
      excludeProductIds: string[];
    }
  | { type: "restart" }
  | { type: "stop" };

export interface FlowOutput {
  state: ConversationState;
  messages: OutboundMessage[];
  effect?: FlowEffect;
}

export const TEXTS = {
  welcome:
    "היי! 🎁 אני GiftBot — אעזור לכם למצוא מתנה מתאימה בכמה שאלות קצרות.\nבכל שלב אפשר לכתוב \"התחל מחדש\" או \"עזרה\".",
  help:
    "אני שואל כמה שאלות קצרות ומציע עד 5 מתנות מתאימות.\n• אפשר ללחוץ על הכפתורים או לכתוב תשובה\n• \"התחל מחדש\" — חיפוש חדש\n• \"הסר\" — הפסקת קבלת הודעות",
  notUnderstood: "לא הבנתי 🙂 אפשר לבחור מהאפשרויות או לכתוב שוב.",
  budgetNotUnderstood: "לא הצלחתי להבין את התקציב 🙂 כתבו סכום בשקלים, למשל 250 או 200-300.",
  chooseAction: "אפשר לבחור אחת האפשרויות, או לכתוב \"התחל מחדש\" לחיפוש חדש.",
  stopped: "הוסרתם ✔️ לא נשלח הודעות נוספות.\nכדי לחזור בכל זמן, כתבו \"התחל\".",
} as const;

const LIST_BUTTON = "בחירה";

const QUESTIONS: Record<Exclude<Step, "results">, () => OutboundMessage> = {
  ask_recipient: () => list("למי המתנה? 🎁", toChoices(RECIPIENT_OPTIONS)),
  ask_occasion: () => list("מה האירוע? 🎉", toChoices(OCCASION_OPTIONS)),
  ask_budget: () =>
    buttons("מה התקציב? 💰\nאפשר לבחור, או לכתוב סכום בשקלים (למשל 250 או 200-300).", toChoices(BUDGET_OPTIONS)),
  ask_interests: () => list("במה מקבל/ת המתנה מתעניין/ת?", toChoices(INTEREST_OPTIONS)),
  ask_avoid: () => list("יש משהו שכדאי להימנע ממנו?", toChoices(AVOID_OPTIONS)),
  ask_deadline: () => buttons("מתי צריך את המתנה? 📅", toChoices(DEADLINE_OPTIONS)),
  ask_international: () =>
    buttons("אפשר גם משלוח מחו״ל? ✈️\n(לרוב לוקח יותר זמן)", toChoices(INTERNATIONAL_OPTIONS)),
};

/** First message of a new conversation. */
export function startConversation(): FlowOutput {
  const state = initialState();
  return { state, messages: [text(TEXTS.welcome), QUESTIONS.ask_recipient()] };
}

/** Handles one inbound message in an existing conversation. */
export function handleInput(state: ConversationState, content: InboundContent, now: Date): FlowOutput {
  const typed = content.type === "text" ? normalizeText(content.text) : undefined;

  // Commands work from any step.
  if (typed !== undefined) {
    if (isCommand(typed, COMMAND_WORDS.stop)) return { state, messages: [text(TEXTS.stopped)], effect: { type: "stop" } };
    if (isCommand(typed, COMMAND_WORDS.restart)) return { ...startConversation(), effect: { type: "restart" } };
    if (isCommand(typed, COMMAND_WORDS.help)) return { state, messages: [text(TEXTS.help), ...repeatCurrent(state)] };
  }
  if (content.type === "choice" && content.id === ACTIONS.restart.id) {
    return { ...startConversation(), effect: { type: "restart" } };
  }

  // Post-results actions.
  if (content.type === "choice" && content.id.startsWith("act:")) {
    return handleAction(state, content.id);
  }

  // A tapped option from any question (also lets users correct an earlier answer by tapping its old button).
  if (content.type === "choice") {
    const answers = applyChoice(state.answers, content.id, now);
    if (!answers) return notUnderstood(state);
    return advance({ ...state, answers });
  }

  // Typed answer to the current question.
  const answers = applyTypedAnswer(state, content.text, now);
  if (!answers) {
    if (state.step === "results") return { state, messages: [actionsMessage(TEXTS.chooseAction)] };
    if (state.step === "ask_budget") return { state, messages: [text(TEXTS.budgetNotUnderstood)] };
    return notUnderstood(state);
  }
  return advance({ ...state, answers });
}

/** Builds the reply after the engine ran for a `recommend` effect. */
export function afterRecommendation(
  state: ConversationState,
  run: { mode: RecommendMode; result: RecommendationResult; sessionId: string },
): FlowOutput {
  const { result } = run;
  if (result.recommendations.length === 0) {
    const nextState: ConversationState = { ...state, step: "results", lastSessionId: run.sessionId };
    const messages = renderNoResults({
      mode: run.mode,
      suggestions: suggestFixes(state, result),
      catalogEmpty: result.evaluatedCount === 0 && run.mode === "initial",
    });
    return { state: nextState, messages };
  }
  const nextState: ConversationState = {
    ...state,
    step: "results",
    shownProductIds: [...state.shownProductIds, ...result.recommendations.map((r) => r.product.id)],
    resultsShown: true,
    lastSessionId: run.sessionId,
  };
  return { state: nextState, messages: renderResults(result.recommendations, run.mode, resultActions()) };
}

// ---------------------------------------------------------------------------

/** Moves to the next unanswered question, or requests recommendations when everything needed is known. */
function advance(state: ConversationState): FlowOutput {
  const answers = fillImpliedAnswers(state.answers);
  const next = nextStep(answers);
  if (next !== "results") {
    return { state: { ...state, answers, step: next }, messages: [QUESTIONS[next]()] };
  }
  // A changed answer starts a fresh result list.
  const fresh: ConversationState = { ...state, answers, step: "results", shownProductIds: [] };
  return {
    state: fresh,
    messages: [text("רגע, מחפש בשבילכם... 🔎")],
    effect: recommendEffect(fresh, "initial"),
  };
}

/** Skips questions that don't make sense given other answers. */
function fillImpliedAnswers(answers: Answers): Answers {
  const filled = { ...answers };
  if (filled.recipient === "baby" && filled.interests === undefined) filled.interests = [];
  // International delivery can't realistically arrive within 3 days.
  if (filled.deadline === "within_3_days" && filled.allowInternational === undefined) filled.allowInternational = false;
  return filled;
}

export function nextStep(a: Answers): Step {
  if (a.recipient === undefined) return "ask_recipient";
  if (a.occasion === undefined) return "ask_occasion";
  if (a.budget === undefined) return "ask_budget";
  if (a.interests === undefined) return "ask_interests";
  if (a.avoid === undefined) return "ask_avoid";
  if (a.deadline === undefined) return "ask_deadline";
  if (a.allowInternational === undefined) return "ask_international";
  return "results";
}

function applyChoice(answers: Answers, id: string, now: Date): Answers | undefined {
  const prefix = id.split(":")[0];
  switch (prefix) {
    case "r": {
      const o = matchOption(RECIPIENT_OPTIONS, { id });
      return o && { ...answers, recipient: o.value };
    }
    case "o": {
      const o = matchOption(OCCASION_OPTIONS, { id });
      return o && { ...answers, occasion: o.value };
    }
    case "b": {
      const o = matchOption(BUDGET_OPTIONS, { id });
      return o && { ...answers, budget: { max: o.value } };
    }
    case "i": {
      const o = matchOption(INTEREST_OPTIONS, { id });
      return o && { ...answers, interests: o.value ? [o.value] : [], generalIdeas: undefined };
    }
    case "a": {
      const o = matchOption(AVOID_OPTIONS, { id });
      return o && { ...answers, avoid: o.value ? [o.value] : [] };
    }
    case "d": {
      const o = matchOption(DEADLINE_OPTIONS, { id });
      return o && withDeadline(answers, o.value, now);
    }
    case "x": {
      const o = matchOption(INTERNATIONAL_OPTIONS, { id });
      return o && { ...answers, allowInternational: o.value };
    }
    default:
      return undefined;
  }
}

function applyTypedAnswer(state: ConversationState, raw: string, now: Date): Answers | undefined {
  const a = state.answers;
  const input = { text: raw };
  switch (state.step) {
    case "ask_recipient": {
      const o = matchOption(RECIPIENT_OPTIONS, input);
      return o && { ...a, recipient: o.value };
    }
    case "ask_occasion": {
      const o = matchOption(OCCASION_OPTIONS, input);
      return o && { ...a, occasion: o.value };
    }
    case "ask_budget": {
      const b = parseBudget(raw);
      return b && { ...a, budget: b };
    }
    case "ask_interests": {
      const o = matchOption(INTEREST_OPTIONS, input);
      return o && { ...a, interests: o.value ? [o.value] : [] };
    }
    case "ask_avoid": {
      const o = matchOption(AVOID_OPTIONS, input);
      return o && { ...a, avoid: o.value ? [o.value] : [] };
    }
    case "ask_deadline": {
      const o = matchOption(DEADLINE_OPTIONS, input);
      return o && withDeadline(a, o.value, now);
    }
    case "ask_international": {
      const o = matchOption(INTERNATIONAL_OPTIONS, input);
      return o && { ...a, allowInternational: o.value };
    }
    case "results":
      return undefined;
  }
}

function withDeadline(answers: Answers, choice: Answers["deadline"] & string, now: Date): Answers {
  const days = DEADLINE_DAYS[choice];
  const neededBy = days === undefined ? null : new Date(now.getTime() + days * 86_400_000).toISOString();
  const next: Answers = { ...answers, deadline: choice, neededBy };
  // Re-ask about international shipping if it was implied by an earlier urgent deadline.
  if (answers.deadline === "within_3_days" && choice !== "within_3_days") next.allowInternational = undefined;
  return next;
}

function handleAction(state: ConversationState, id: string): FlowOutput {
  if (state.step !== "results" || nextStep(state.answers) !== "results") return notUnderstood(state);
  const a = state.answers;
  const searching = [text("רגע, מחפש... 🔎")];

  switch (id) {
    case ACTIONS.more.id:
      return { state, messages: searching, effect: recommendEffect(state, "more") };
    case ACTIONS.cheaper.id: {
      const max = Math.max(10, Math.round((a.budget!.max * 0.7) / 10) * 10);
      const next = { ...state, answers: { ...a, budget: { max } } };
      return { state: next, messages: searching, effect: recommendEffect(next, "cheaper") };
    }
    case ACTIONS.raiseBudget.id: {
      const max = Math.round((a.budget!.max * 1.5) / 10) * 10;
      return rerun({ ...state, answers: { ...a, budget: { min: a.budget!.min, max } } });
    }
    case ACTIONS.generalIdeas.id:
      return rerun({ ...state, answers: { ...a, generalIdeas: true } });
    case ACTIONS.noDeadline.id:
      return rerun({ ...state, answers: { ...a, deadline: "no_rush", neededBy: null } });
    case ACTIONS.allowInternational.id:
      return rerun({ ...state, answers: { ...a, allowInternational: true } });
    default:
      return notUnderstood(state);
  }
}

/** Re-runs a search with relaxed answers, starting a fresh result list. */
function rerun(state: ConversationState): FlowOutput {
  const fresh = { ...state, shownProductIds: [] };
  return { state: fresh, messages: [text("רגע, מחפש... 🔎")], effect: recommendEffect(fresh, "initial") };
}

function recommendEffect(state: ConversationState, mode: RecommendMode): FlowEffect {
  return {
    type: "recommend",
    mode,
    request: buildRequest(state.answers),
    requireInterestMatch: state.answers.generalIdeas !== true,
    excludeProductIds: mode === "initial" ? [] : state.shownProductIds,
  };
}

export function buildRequest(a: Answers): GiftRequest {
  return parseGiftRequest({
    recipient: a.recipient,
    occasion: a.occasion,
    budget: { ...a.budget, currency: "ILS" },
    interests: a.interests ?? [],
    avoid: a.avoid ?? [],
    neededBy: a.neededBy ?? undefined,
    deliveryCountry: "IL",
    allowInternationalShipping: a.allowInternational ?? true,
  });
}

/** Picks up to two fixes that address the most common exclusion reasons. */
export function suggestFixes(state: ConversationState, result: RecommendationResult): ChoiceOption[] {
  const counts = countExclusionReasons(result);
  const a = state.answers;
  const candidates: { action: ChoiceOption; count: number }[] = [
    { action: ACTIONS.raiseBudget, count: (counts.over_budget ?? 0) + (counts.under_budget ?? 0) },
    { action: ACTIONS.generalIdeas, count: a.generalIdeas ? 0 : (counts.no_interest_match ?? 0) },
    { action: ACTIONS.noDeadline, count: a.neededBy ? (counts.delivery_too_slow ?? 0) + (counts.deadline_passed ?? 0) : 0 },
    {
      action: ACTIONS.allowInternational,
      count: a.allowInternational === false ? (counts.international_shipping_not_allowed ?? 0) : 0,
    },
  ];
  return candidates
    .filter((c) => c.count > 0)
    .sort((x, y) => y.count - x.count)
    .slice(0, 2)
    .map((c) => c.action);
}

function resultActions(): ChoiceOption[] {
  return [ACTIONS.more, ACTIONS.cheaper, ACTIONS.restart];
}

function actionsMessage(body: string): OutboundMessage {
  return buttons(body, resultActions());
}

function repeatCurrent(state: ConversationState): OutboundMessage[] {
  return state.step === "results" ? [actionsMessage("מה תרצו לעשות?")] : [QUESTIONS[state.step]()];
}

function notUnderstood(state: ConversationState): FlowOutput {
  return { state, messages: [text(TEXTS.notUnderstood), ...repeatCurrent(state)] };
}

function isCommand(typed: string, words: readonly string[]): boolean {
  return words.some((w) => normalizeText(w) === typed);
}

function text(body: string): OutboundMessage {
  return { type: "text", body };
}

function buttons(body: string, options: ChoiceOption[]): OutboundMessage {
  return { type: "buttons", body, buttons: options };
}

function list(body: string, options: ChoiceOption[]): OutboundMessage {
  return { type: "list", body, buttonLabel: LIST_BUTTON, options };
}
