import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp, MAX_BODY_BYTES, WHATSAPP_WEBHOOK_PATH } from "../../src/app.js";
import { createWhatsAppClient } from "../../src/channels/whatsapp/client.js";
import { signBody } from "../../src/channels/whatsapp/signature.js";
import type { WhatsAppWebhookDeps } from "../../src/channels/whatsapp/webhook.js";
import type { InboundMessage } from "../../src/conversation/messages.js";
import { TEXTS } from "../../src/conversation/flow.js";
import { SAMPLE_EXCHANGE_RATES } from "../../src/data/sample-products.js";
import { seedSampleCatalog } from "../../src/data/seed-sample.js";
import type { Database } from "../../src/db/database.js";
import type { Logger } from "../../src/logger.js";
import { handleInboundMessage } from "../../src/services/conversation-service.js";
import { createTestDatabase, resetTables } from "../db-helpers.js";
import {
  APP_SECRET,
  buttonReply,
  fakeGraphApi,
  listReply,
  notification,
  PHONE_NUMBER_ID,
  statusUpdate,
  textMessage,
  TIMESTAMP,
  USER_WA_ID,
  VERIFY_TOKEN,
} from "../channels/whatsapp/fixtures.js";

let db: Database;
let server: Server;
let baseUrl: string;
let api: ReturnType<typeof fakeGraphApi>;
let tasks: Promise<void>[];
let logs: { level: string; event: string; fields?: Record<string, unknown> }[];
let failProcessing: boolean;

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);
afterAll(async () => db?.close());

beforeEach(async () => {
  await resetTables(db);
  await seedSampleCatalog(db);
  api = fakeGraphApi();
  tasks = [];
  logs = [];
  failProcessing = false;
  const logger: Logger = { log: (level, event, fields) => logs.push({ level, event, fields }) };
  const whatsapp: WhatsAppWebhookDeps = {
    verifyToken: VERIFY_TOKEN,
    appSecret: APP_SECRET,
    phoneNumberId: PHONE_NUMBER_ID,
    client: createWhatsAppClient({
      accessToken: "TEST-TOKEN",
      phoneNumberId: PHONE_NUMBER_ID,
      graphApiVersion: "v26.0",
      fetch: (...args) => api.fetch(...args),
      retryBaseDelayMs: 1,
    }),
    processMessage: (inbound: InboundMessage) => {
      if (failProcessing) throw new Error("database unavailable");
      return handleInboundMessage(db, inbound, {
        getExchangeRates: () => SAMPLE_EXCHANGE_RATES,
        engineOptions: { allowSampleProducts: true },
      });
    },
    logger,
    trackBackground: (t) => tasks.push(t),
  };
  server = createApp({ whatsapp });
  await new Promise<void>((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

/** Posts a signed webhook and waits until all replies were sent. */
async function deliver(payload: unknown, opts: { signature?: string; raw?: string } = {}) {
  const body = opts.raw ?? JSON.stringify(payload);
  const res = await fetch(`${baseUrl}${WHATSAPP_WEBHOOK_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": opts.signature ?? signBody(body, APP_SECRET) },
    body,
  });
  await Promise.all(tasks);
  return res;
}

/** Sends one user message and returns the Graph API requests it caused. */
async function say(message: unknown) {
  const before = api.calls.length;
  const res = await deliver(notification([message]));
  expect(res.status).toBe(200);
  return api.calls.slice(before).map((c) => c.body);
}

describe("webhook verification (GET)", () => {
  it("completes Meta's handshake", async () => {
    const q = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "42" });
    const res = await fetch(`${baseUrl}${WHATSAPP_WEBHOOK_PATH}?${q}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("42");
  });

  it("rejects a wrong verify token", async () => {
    const q = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "42" });
    expect((await fetch(`${baseUrl}${WHATSAPP_WEBHOOK_PATH}?${q}`)).status).toBe(403);
  });
});

describe("webhook security and robustness (POST)", () => {
  it("rejects unsigned or wrongly signed requests and processes nothing", async () => {
    const payload = notification([textMessage("היי")]);
    expect((await deliver(payload, { signature: "" })).status).toBe(401);
    expect((await deliver(payload, { signature: signBody("other", APP_SECRET) })).status).toBe(401);
    expect(api.calls).toEqual([]);
    expect((await db.query("select 1 from public.users")).rows).toEqual([]);
  });

  it("rejects invalid JSON", async () => {
    expect((await deliver(null, { raw: "{not json" })).status).toBe(400);
  });

  it("rejects oversized bodies", async () => {
    const res = await deliver(null, { raw: "x".repeat(MAX_BODY_BYTES + 1) });
    expect(res.status).toBe(413);
  });

  it("acknowledges status updates and unknown notifications without replying", async () => {
    expect((await deliver(statusUpdate())).status).toBe(200);
    expect((await deliver({ object: "page", entry: [] })).status).toBe(200);
    expect(api.calls).toEqual([]);
  });

  it("returns 500 when processing fails, so Meta retries — and the retry works", async () => {
    const message = textMessage("היי", { id: "wamid.RETRY" });
    failProcessing = true;
    expect((await deliver(notification([message]))).status).toBe(500);
    expect(api.calls).toEqual([]);
    failProcessing = false;
    expect((await deliver(notification([message]))).status).toBe(200);
    expect(api.calls.length).toBeGreaterThan(0);
  });

  it("does not reply twice to a duplicate delivery", async () => {
    const payload = notification([textMessage("היי", { id: "wamid.DUP" })]);
    await deliver(payload);
    const sent = api.calls.length;
    await deliver(payload);
    expect(api.calls.length).toBe(sent);
  });

  it("stops sending to a user after a failed send (to keep order) and logs without the phone number", async () => {
    api = fakeGraphApi((n) => (n === 1 ? { status: 400, body: { error: { message: "bad", code: 100 } } } : { status: 200, body: { messages: [{ id: "x" }] } }));
    const res = await deliver(notification([textMessage("היי")]));
    expect(res.status).toBe(200);
    expect(api.calls).toHaveLength(1); // welcome failed → the question after it was not sent
    const failure = logs.find((l) => l.event === "whatsapp.send_failed");
    expect(failure?.fields).toMatchObject({ to: "9725*****567", code: 100, status: 400 });
    expect(JSON.stringify(logs)).not.toContain(USER_WA_ID);
  });
});

describe("a full WhatsApp conversation", () => {
  it("from 'היי' to product recommendations, in order, to the right number", async () => {
    const welcome = await say(textMessage("היי"));
    expect(welcome.map((m) => m.type)).toEqual(["text", "interactive"]);
    expect(welcome[0]).toMatchObject({ to: USER_WA_ID, text: { body: TEXTS.welcome } });
    expect(welcome[1]).toMatchObject({ interactive: { type: "list", body: { text: "למי המתנה? 🎁" } } });

    await say(listReply("r:colleague"));
    await say(listReply("o:housewarming"));
    await say(buttonReply("b:300"));
    await say(listReply("i:coffee"));
    await say(listReply("a:none"));
    await say(buttonReply("d:none"));
    const results = await say(buttonReply("x:yes"));

    expect(results.every((m) => m.to === USER_WA_ID)).toBe(true);
    const images = results.filter((m) => m.type === "image");
    expect(images.length).toBeGreaterThan(0);
    expect(images[0]).toMatchObject({ image: { link: "https://example.com/sample/coffee-tasting-kit.jpg" } });
    expect(images[0]!.image.caption).toContain("ערכת טעימות קפה");
    expect(images[0]!.image.caption).toContain("⚠️ מוצר לדוגמה");
    expect(results.at(-1)).toMatchObject({
      type: "interactive",
      interactive: { type: "button", action: { buttons: [{ reply: { id: "act:more" } }, { reply: { id: "act:cheaper" } }, { reply: { id: "act:restart" } }] } },
    });
  });

  it("answers voice notes/images with a friendly explanation", async () => {
    await say(textMessage("היי"));
    const reply = await say({ from: USER_WA_ID, id: "wamid.AUDIO", timestamp: TIMESTAMP, type: "audio", audio: { id: "m1" } });
    expect(reply[0]).toMatchObject({ type: "text", text: { body: TEXTS.unsupported } });
  });

  it("handles several messages in one notification, in order", async () => {
    const res = await deliver(notification([textMessage("היי"), listReply("r:friend")]));
    expect(res.status).toBe(200);
    const types = api.calls.map((c) => c.body.interactive?.body?.text ?? c.body.text?.body);
    expect(types).toEqual([TEXTS.welcome, "למי המתנה? 🎁", "מה האירוע? 🎉"]);
  });
});

describe("when WhatsApp is not configured", () => {
  it("the webhook route does not exist", async () => {
    const plain = createApp();
    await new Promise<void>((r) => plain.listen(0, r));
    const url = `http://127.0.0.1:${(plain.address() as AddressInfo).port}${WHATSAPP_WEBHOOK_PATH}`;
    expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(404);
    await new Promise<void>((r) => plain.close(() => r()));
  });
});
