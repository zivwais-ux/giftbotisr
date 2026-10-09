import { afterRecommendation, handleInput, startConversation, type FlowOutput } from "../conversation/flow.js";
import type { InboundMessage, OutboundMessage } from "../conversation/messages.js";
import { COMMAND_WORDS, normalizeText } from "../conversation/options.js";
import { parseStoredState, type ConversationState } from "../conversation/state.js";
import {
  claimMessage,
  closeConversation,
  createConversation,
  findActiveConversation,
  linkMessageToUser,
  recordEvent,
  saveConversationState,
  setOptedOut,
  upsertUser,
  type ConversationRecord,
} from "../db/conversation-repository.js";
import type { Database, Queryable } from "../db/database.js";
import type { ExchangeRates } from "../domain/money.js";
import type { EngineOptions } from "../recommendation/context.js";
import { countExclusionReasons } from "../recommendation/stats.js";
import { runRecommendation } from "./recommendation-service.js";

export interface ConversationDeps {
  /** Supplies current exchange rates. Must come from a real, dated source in production. */
  getExchangeRates: () => ExchangeRates | Promise<ExchangeRates>;
  engineOptions?: Partial<EngineOptions>;
  /** A conversation idle longer than this is closed and the next message starts a new one. */
  inactivityTimeoutMs?: number;
}

export const DEFAULT_INACTIVITY_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export interface HandleResult {
  /** Messages to send back, in order. Empty when nothing should be sent. */
  messages: OutboundMessage[];
  /** True when this message id was already processed (duplicate delivery) — nothing was done. */
  duplicate: boolean;
}

/**
 * Processes one inbound message end to end, atomically: deduplicate, identify the user,
 * advance the conversation, run recommendations if needed, persist state and analytics.
 * Sending the returned messages is the caller's (channel adapter's) job, after this returns.
 */
export async function handleInboundMessage(
  db: Database,
  inbound: InboundMessage,
  deps: ConversationDeps,
): Promise<HandleResult> {
  return db.transaction(async (tx) => {
    const now = inbound.receivedAt;
    if (!(await claimMessage(tx, inbound.messageId, now))) return { messages: [], duplicate: true };

    const user = await upsertUser(tx, inbound.from, now);
    await linkMessageToUser(tx, inbound.messageId, user.id);
    const ctx: Ctx = { tx, userId: user.id, now, deps };

    if (user.optedOutAt) {
      // Opted-out users get no messages — unless they explicitly ask to start again.
      if (!isTypedCommand(inbound, COMMAND_WORDS.restart)) return { messages: [], duplicate: false };
      await setOptedOut(tx, user.id, null);
    }

    let conversation = await findActiveConversation(tx, user.id);
    if (conversation && now.getTime() - conversation.lastMessageAt.getTime() > timeout(deps)) {
      await closeWithOutcome(ctx, conversation);
      conversation = undefined;
    }
    const state = conversation && parseStoredState(conversation.step, conversation.collected);
    if (!conversation || !state) {
      if (conversation) await closeWithOutcome(ctx, conversation); // corrupt state: start over cleanly
      return { messages: await startNew(ctx, startConversation()), duplicate: false };
    }

    const out = handleInput(state, inbound.content, now);
    switch (out.effect?.type) {
      case "stop":
        await setOptedOut(tx, user.id, now);
        await closeWithOutcome(ctx, conversation);
        return { messages: out.messages, duplicate: false };
      case "restart":
        await closeWithOutcome(ctx, conversation);
        return { messages: await startNew(ctx, out), duplicate: false };
      case "recommend":
        return { messages: await recommendAndSave(ctx, conversation.id, state, out), duplicate: false };
      default:
        await saveConversationState(tx, conversation.id, out.state, now);
        return { messages: out.messages, duplicate: false };
    }
  });
}

interface Ctx {
  tx: Queryable;
  userId: string;
  now: Date;
  deps: ConversationDeps;
}

async function startNew(ctx: Ctx, out: FlowOutput): Promise<OutboundMessage[]> {
  const conversationId = await createConversation(ctx.tx, ctx.userId, out.state, ctx.now);
  await recordEvent(ctx.tx, {
    type: "conversation_started",
    userId: ctx.userId,
    conversationId,
    occurredAt: ctx.now,
  });
  return out.messages;
}

async function recommendAndSave(
  ctx: Ctx,
  conversationId: string,
  before: ConversationState,
  out: FlowOutput,
): Promise<OutboundMessage[]> {
  if (out.effect?.type !== "recommend") throw new Error("expected a recommend effect");
  const effect = out.effect;

  const run = await runRecommendation(ctx.tx, {
    request: effect.request,
    exchangeRates: await ctx.deps.getExchangeRates(),
    now: ctx.now,
    options: { ...ctx.deps.engineOptions, requireInterestMatch: effect.requireInterestMatch },
    excludeProductIds: effect.excludeProductIds,
    conversationId,
    userId: ctx.userId,
  });
  const reply = afterRecommendation(out.state, { mode: effect.mode, result: run.result, sessionId: run.sessionId });
  const count = run.result.recommendations.length;

  await recordEvent(ctx.tx, {
    type: count > 0 ? "recommendations_shown" : "no_results",
    userId: ctx.userId,
    conversationId,
    sessionId: run.sessionId,
    properties:
      count > 0
        ? { mode: effect.mode, count }
        : { mode: effect.mode, exclusion_stats: countExclusionReasons(run.result) },
    occurredAt: ctx.now,
  });
  if (count > 0 && !before.resultsShown) {
    await recordEvent(ctx.tx, {
      type: "conversation_completed",
      userId: ctx.userId,
      conversationId,
      sessionId: run.sessionId,
      occurredAt: ctx.now,
    });
  }

  await saveConversationState(ctx.tx, conversationId, reply.state, ctx.now);
  return [...out.messages, ...reply.messages];
}

/** Closes a conversation: "completed" if the user saw results, otherwise "abandoned". */
async function closeWithOutcome(ctx: Ctx, conversation: ConversationRecord): Promise<void> {
  const state = parseStoredState(conversation.step, conversation.collected);
  const completed = state?.resultsShown === true;
  await closeConversation(ctx.tx, conversation.id, completed ? "completed" : "abandoned", ctx.now);
  if (!completed) {
    await recordEvent(ctx.tx, {
      type: "conversation_abandoned",
      userId: ctx.userId,
      conversationId: conversation.id,
      properties: { last_step: conversation.step },
      occurredAt: ctx.now,
    });
  }
}

function isTypedCommand(inbound: InboundMessage, words: readonly string[]): boolean {
  if (inbound.content.type !== "text") return false;
  const typed = normalizeText(inbound.content.text);
  return words.some((w) => normalizeText(w) === typed);
}

function timeout(deps: ConversationDeps): number {
  return deps.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT_MS;
}
