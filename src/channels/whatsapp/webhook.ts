import type { InboundMessage, OutboundMessage } from "../../conversation/messages.js";
import { maskPhone, type Logger } from "../../logger.js";
import type { WhatsAppClient } from "./client.js";
import { parseNotification } from "./inbound.js";
import { toCloudApiMessage } from "./outbound.js";
import { verifySignature } from "./signature.js";

export interface WhatsAppWebhookDeps {
  /** The token you choose and enter in the Meta dashboard when registering the webhook. */
  verifyToken: string;
  /** The Meta app secret, used to verify request signatures. */
  appSecret: string;
  /** Only messages to this business phone number are processed. */
  phoneNumberId: string;
  client: WhatsAppClient;
  /** Processes one inbound message and returns the replies (the conversation service). */
  processMessage: (inbound: InboundMessage) => Promise<{ messages: OutboundMessage[] }>;
  logger: Logger;
  /** Receives the background sending task (lets tests and graceful shutdown await it). */
  trackBackground?: (task: Promise<void>) => void;
}

export interface HttpResult {
  status: number;
  body: string;
}

/** GET handshake: Meta calls this once when the webhook URL is registered. */
export function verifySubscription(query: URLSearchParams, verifyToken: string): HttpResult {
  if (query.get("hub.mode") === "subscribe" && query.get("hub.verify_token") === verifyToken) {
    return { status: 200, body: query.get("hub.challenge") ?? "" };
  }
  return { status: 403, body: "forbidden" };
}

/**
 * POST notification. Messages are processed (and persisted) before responding, so a failure
 * returns 500 and Meta retries — safely, because processing is deduplicated and transactional.
 * Replies are sent after the 200 response, so slow sends never trigger Meta's retry.
 */
export async function receiveNotification(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  deps: WhatsAppWebhookDeps,
): Promise<HttpResult> {
  if (!verifySignature(rawBody, signatureHeader, deps.appSecret)) {
    deps.logger.log("warn", "whatsapp.invalid_signature");
    return { status: 401, body: "invalid signature" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { status: 400, body: "invalid json" };
  }

  let parsed;
  try {
    parsed = parseNotification(payload, deps.phoneNumberId);
  } catch {
    // Signed by Meta but not a shape we handle: acknowledge so Meta doesn't retry forever.
    deps.logger.log("warn", "whatsapp.unrecognized_notification");
    return { status: 200, body: "ok" };
  }
  if (parsed.skipped > 0) deps.logger.log("warn", "whatsapp.messages_skipped", { count: parsed.skipped });

  const replies: { to: string; messages: OutboundMessage[] }[] = [];
  for (const inbound of parsed.messages) {
    try {
      const result = await deps.processMessage(inbound);
      if (result.messages.length > 0) replies.push({ to: inbound.from, messages: result.messages });
    } catch (err) {
      deps.logger.log("error", "whatsapp.processing_failed", {
        messageId: inbound.messageId,
        error: (err as Error).message,
      });
      return { status: 500, body: "processing failed" };
    }
  }

  if (replies.length > 0) {
    const task = sendReplies(replies, deps);
    deps.trackBackground?.(task);
  }
  return { status: 200, body: "ok" };
}

/** Sends each user's replies in order. If one fails, the rest for that user are skipped (to keep order). */
async function sendReplies(
  replies: { to: string; messages: OutboundMessage[] }[],
  deps: WhatsAppWebhookDeps,
): Promise<void> {
  for (const { to, messages } of replies) {
    for (const [index, message] of messages.entries()) {
      try {
        await deps.client.send(toCloudApiMessage(to, message));
      } catch (err) {
        const e = err as Error & { code?: number; status?: number };
        deps.logger.log("error", "whatsapp.send_failed", {
          to: maskPhone(to),
          messageIndex: index,
          status: e.status,
          code: e.code,
          error: e.message,
        });
        break;
      }
    }
  }
}
