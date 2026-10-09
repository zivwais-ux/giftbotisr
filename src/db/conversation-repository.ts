import type { ConversationState } from "../conversation/state.js";
import { toStoredState } from "../conversation/state.js";
import type { Queryable } from "./database.js";

/**
 * Records a provider message id. Returns false if it was already recorded (a duplicate delivery).
 * Must run inside the same transaction as the message's processing, so a failed run can be retried.
 */
export async function claimMessage(tx: Queryable, messageId: string, receivedAt: Date): Promise<boolean> {
  const { rows } = await tx.query(
    `insert into public.processed_messages (provider_message_id, received_at) values ($1, $2)
     on conflict (provider_message_id) do nothing
     returning provider_message_id`,
    [messageId, receivedAt],
  );
  return rows.length === 1;
}

export async function linkMessageToUser(tx: Queryable, messageId: string, userId: string): Promise<void> {
  await tx.query("update public.processed_messages set user_id = $2 where provider_message_id = $1", [
    messageId,
    userId,
  ]);
}

export interface UserRecord {
  id: string;
  optedOutAt: Date | null;
}

/**
 * Creates the user on first contact and updates last_seen_at. The upsert also row-locks the user
 * until the transaction ends, so concurrent messages from the same user are processed one at a time.
 */
export async function upsertUser(tx: Queryable, whatsappId: string, seenAt: Date): Promise<UserRecord> {
  const { rows } = await tx.query<{ id: string; opted_out_at: Date | null }>(
    `insert into public.users (whatsapp_id, last_seen_at) values ($1, $2)
     on conflict (whatsapp_id) do update set last_seen_at = excluded.last_seen_at
     returning id, opted_out_at`,
    [whatsappId, seenAt],
  );
  const row = rows[0]!;
  return { id: row.id, optedOutAt: row.opted_out_at ? new Date(row.opted_out_at) : null };
}

export async function setOptedOut(tx: Queryable, userId: string, at: Date | null): Promise<void> {
  await tx.query("update public.users set opted_out_at = $2 where id = $1", [userId, at]);
}

export interface ConversationRecord {
  id: string;
  step: string;
  collected: unknown;
  lastMessageAt: Date;
}

/** The user's active conversation, row-locked for this transaction. */
export async function findActiveConversation(tx: Queryable, userId: string): Promise<ConversationRecord | undefined> {
  const { rows } = await tx.query<{ id: string; step: string; collected: unknown; last_message_at: Date }>(
    `select id, step, collected, last_message_at from public.conversations
     where user_id = $1 and status = 'active'
     for update`,
    [userId],
  );
  const row = rows[0];
  return row && { id: row.id, step: row.step, collected: row.collected, lastMessageAt: new Date(row.last_message_at) };
}

export async function createConversation(
  tx: Queryable,
  userId: string,
  state: ConversationState,
  at: Date,
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `insert into public.conversations (user_id, step, collected, last_message_at, created_at)
     values ($1, $2, $3, $4, $4)
     returning id`,
    [userId, state.step, JSON.stringify(toStoredState(state)), at],
  );
  return rows[0]!.id;
}

export async function saveConversationState(
  tx: Queryable,
  conversationId: string,
  state: ConversationState,
  at: Date,
): Promise<void> {
  await tx.query(
    "update public.conversations set step = $2, collected = $3, last_message_at = $4 where id = $1",
    [conversationId, state.step, JSON.stringify(toStoredState(state)), at],
  );
}

export async function closeConversation(
  tx: Queryable,
  conversationId: string,
  status: "completed" | "abandoned",
  at: Date,
): Promise<void> {
  await tx.query("update public.conversations set status = $2, completed_at = $3 where id = $1", [
    conversationId,
    status,
    at,
  ]);
}

export type AnalyticsEventType =
  | "conversation_started"
  | "conversation_completed"
  | "conversation_abandoned"
  | "recommendations_shown"
  | "no_results"
  | "link_clicked"
  | "feedback_submitted"
  | "conversion_reported";

export interface AnalyticsEvent {
  type: AnalyticsEventType;
  userId?: string;
  conversationId?: string;
  sessionId?: string;
  /** Never include personal data (phone numbers, message text). */
  properties?: Record<string, unknown>;
  occurredAt: Date;
}

export async function recordEvent(tx: Queryable, event: AnalyticsEvent): Promise<void> {
  await tx.query(
    `insert into public.analytics_events (event_type, user_id, conversation_id, session_id, properties, occurred_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      event.type,
      event.userId ?? null,
      event.conversationId ?? null,
      event.sessionId ?? null,
      JSON.stringify(event.properties ?? {}),
      event.occurredAt,
    ],
  );
}
