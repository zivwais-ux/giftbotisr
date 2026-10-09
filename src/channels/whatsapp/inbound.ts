import { z } from "zod";
import type { InboundContent, InboundMessage } from "../../conversation/messages.js";

/**
 * Parser for WhatsApp Cloud API webhook notifications ("messages" field).
 * Only the fields we use are validated; unknown fields are ignored so Meta can add fields safely.
 */

const MessageSchema = z.object({
  from: z.string().regex(/^\d{6,20}$/),
  id: z.string().min(1).max(255),
  timestamp: z.string().regex(/^\d+$/),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  interactive: z
    .object({
      type: z.string(),
      button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
      list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
    })
    .optional(),
  /** Quick-reply button on a template message. */
  button: z.object({ payload: z.string().optional(), text: z.string() }).optional(),
});

const NotificationSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({
            metadata: z.object({ phone_number_id: z.string() }).optional(),
            messages: z.array(z.unknown()).optional(),
          }),
        }),
      ),
    }),
  ),
});

export interface ParsedNotification {
  messages: InboundMessage[];
  /** Messages present but skipped (malformed, or addressed to another phone number). */
  skipped: number;
}

/**
 * Extracts user messages from a webhook body. Status updates (sent/delivered/read) carry no
 * messages and yield an empty list. Throws only if the body isn't a WhatsApp notification at all.
 */
export function parseNotification(body: unknown, phoneNumberId: string): ParsedNotification {
  const notification = NotificationSchema.parse(body);
  const messages: InboundMessage[] = [];
  let skipped = 0;

  for (const entry of notification.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const raw = change.value.messages ?? [];
      if (change.value.metadata?.phone_number_id !== phoneNumberId) {
        skipped += raw.length;
        continue;
      }
      for (const item of raw) {
        const parsed = MessageSchema.safeParse(item);
        if (!parsed.success) {
          skipped++;
          continue;
        }
        const m = parsed.data;
        messages.push({
          messageId: m.id,
          from: m.from,
          content: toContent(m),
          receivedAt: new Date(Number(m.timestamp) * 1000),
        });
      }
    }
  }
  return { messages, skipped };
}

function toContent(m: z.infer<typeof MessageSchema>): InboundContent {
  if (m.type === "text" && m.text) return { type: "text", text: m.text.body };
  if (m.type === "interactive" && m.interactive) {
    const reply = m.interactive.button_reply ?? m.interactive.list_reply;
    if (reply) return { type: "choice", id: reply.id, title: reply.title };
  }
  if (m.type === "button" && m.button) {
    return m.button.payload ? { type: "choice", id: m.button.payload, title: m.button.text } : { type: "text", text: m.button.text };
  }
  return { type: "unsupported", kind: m.type };
}
