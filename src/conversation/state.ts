import { z } from "zod";
import { OCCASIONS, RECIPIENTS } from "../domain/types.js";

export const STEPS = [
  "ask_recipient",
  "ask_occasion",
  "ask_budget",
  "ask_interests",
  "ask_avoid",
  "ask_deadline",
  "ask_international",
  "results",
] as const;
export type Step = (typeof STEPS)[number];

/**
 * What the user has told us. `undefined` = not asked yet. An empty array / null means
 * "answered: nothing / no preference" so we don't ask again.
 */
export const AnswersSchema = z.object({
  recipient: z.enum(RECIPIENTS).optional(),
  occasion: z.enum(OCCASIONS).optional(),
  budget: z.object({ min: z.number().nonnegative().optional(), max: z.number().positive() }).optional(),
  interests: z.array(z.string()).optional(),
  avoid: z.array(z.string()).optional(),
  deadline: z.enum(["within_3_days", "within_2_weeks", "no_rush"]).optional(),
  /** ISO timestamp the gift is needed by; null = no deadline. Fixed when the user answers. */
  neededBy: z.string().datetime().nullable().optional(),
  allowInternational: z.boolean().optional(),
  /** User accepted suggestions that don't match their stated interests. */
  generalIdeas: z.boolean().optional(),
});
export type Answers = z.infer<typeof AnswersSchema>;

export const ConversationStateSchema = z.object({
  step: z.enum(STEPS),
  answers: AnswersSchema,
  /** Products already shown in this conversation — excluded from "more" / "cheaper". */
  shownProductIds: z.array(z.string()).default([]),
  /** True once results were shown at least once (conversation "completed" for metrics). */
  resultsShown: z.boolean().default(false),
  lastSessionId: z.string().optional(),
});
export type ConversationState = z.infer<typeof ConversationStateSchema>;

export function initialState(): ConversationState {
  return { step: "ask_recipient", answers: {}, shownProductIds: [], resultsShown: false };
}

/** Parses stored state; returns undefined if it is corrupt or from an incompatible version. */
export function parseStoredState(step: string, collected: unknown): ConversationState | undefined {
  const parsed = ConversationStateSchema.safeParse({ ...(collected as object), step });
  return parsed.success ? parsed.data : undefined;
}

/** What is persisted in conversations.collected (step is stored in its own column). */
export function toStoredState(state: ConversationState): Omit<ConversationState, "step"> {
  const { step: _step, ...rest } = state;
  return rest;
}
