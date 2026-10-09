import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { receiveNotification, verifySubscription, type WhatsAppWebhookDeps } from "./channels/whatsapp/webhook.js";

export interface AppDeps {
  /** When absent, the WhatsApp webhook routes respond 404. */
  whatsapp?: WhatsAppWebhookDeps;
}

/** Meta's notifications are small; anything larger is rejected. */
export const MAX_BODY_BYTES = 1024 * 1024;
export const WHATSAPP_WEBHOOK_PATH = "/webhooks/whatsapp";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

class BodyTooLargeError extends Error {}

/** Reads the body up to `limit` bytes. Past the limit, rejects and stops buffering (data is discarded). */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Creates the HTTP server. */
export function createApp(deps: AppDeps = {}): Server {
  return createServer((req, res) => {
    void route(req, res, deps).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: "internal_error" });
    });
  });
}

async function route(req: IncomingMessage, res: ServerResponse, deps: AppDeps): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { status: "ok", service: "giftbot" });
    return;
  }

  if (url.pathname === WHATSAPP_WEBHOOK_PATH && deps.whatsapp) {
    if (req.method === "GET") {
      const result = verifySubscription(url.searchParams, deps.whatsapp.verifyToken);
      sendText(res, result.status, result.body);
      return;
    }
    if (req.method === "POST") {
      let body: Buffer;
      try {
        body = await readBody(req, MAX_BODY_BYTES);
      } catch (err) {
        if (!(err instanceof BodyTooLargeError)) throw err;
        // Answer first, then drop the connection so the sender can't keep streaming.
        res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8", Connection: "close" });
        res.end("payload too large", () => req.destroy());
        return;
      }
      const signature = req.headers["x-hub-signature-256"];
      const result = await receiveNotification(body, typeof signature === "string" ? signature : undefined, deps.whatsapp);
      sendText(res, result.status, result.body);
      return;
    }
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  sendJson(res, 404, { error: "not_found" });
}
