import { describe, expect, it } from "vitest";
import { createWhatsAppClient, WhatsAppApiError } from "../../../src/channels/whatsapp/client.js";
import { parseNotification } from "../../../src/channels/whatsapp/inbound.js";
import { toCloudApiMessage } from "../../../src/channels/whatsapp/outbound.js";
import { signBody, verifySignature } from "../../../src/channels/whatsapp/signature.js";
import { verifySubscription } from "../../../src/channels/whatsapp/webhook.js";
import {
  APP_SECRET,
  buttonReply,
  fakeGraphApi,
  listReply,
  notification,
  PHONE_NUMBER_ID,
  statusUpdate,
  textMessage,
  USER_WA_ID,
  VERIFY_TOKEN,
} from "./fixtures.js";

describe("verifySignature", () => {
  const body = Buffer.from('{"hello":"world"}');

  it("accepts a correct signature", () => {
    expect(verifySignature(body, signBody(body, APP_SECRET), APP_SECRET)).toBe(true);
  });

  it.each([
    ["missing header", undefined],
    ["wrong prefix", signBody(body, APP_SECRET).replace("sha256=", "sha1=")],
    ["wrong secret", signBody(body, "other-secret")],
    ["truncated", signBody(body, APP_SECRET).slice(0, 20)],
    ["garbage", "sha256=not-hex"],
  ])("rejects %s", (_label, header) => {
    expect(verifySignature(body, header, APP_SECRET)).toBe(false);
  });

  it("rejects a body modified after signing", () => {
    const header = signBody(body, APP_SECRET);
    expect(verifySignature(Buffer.from('{"hello":"w0rld"}'), header, APP_SECRET)).toBe(false);
  });
});

describe("verifySubscription", () => {
  it("echoes the challenge for the right token", () => {
    const q = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "1158201444" });
    expect(verifySubscription(q, VERIFY_TOKEN)).toEqual({ status: 200, body: "1158201444" });
  });

  it("refuses a wrong token or mode", () => {
    expect(verifySubscription(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "nope" }), VERIFY_TOKEN).status).toBe(403);
    expect(verifySubscription(new URLSearchParams({ "hub.mode": "other", "hub.verify_token": VERIFY_TOKEN }), VERIFY_TOKEN).status).toBe(403);
  });
});

describe("parseNotification", () => {
  it("parses a text message", () => {
    const { messages } = parseNotification(notification([textMessage("היי", { id: "wamid.A", timestamp: 1_790_000_000 })]), PHONE_NUMBER_ID);
    expect(messages).toEqual([
      { messageId: "wamid.A", from: USER_WA_ID, content: { type: "text", text: "היי" }, receivedAt: new Date(1_790_000_000_000) },
    ]);
  });

  it("parses button and list replies as choices", () => {
    const { messages } = parseNotification(notification([buttonReply("b:300", "עד 300 ₪"), listReply("r:friend", "חבר/ה")]), PHONE_NUMBER_ID);
    expect(messages.map((m) => m.content)).toEqual([
      { type: "choice", id: "b:300", title: "עד 300 ₪" },
      { type: "choice", id: "r:friend", title: "חבר/ה" },
    ]);
  });

  it("parses template quick-reply buttons", () => {
    const msg = { from: USER_WA_ID, id: "wamid.T", timestamp: "1790000000", type: "button", button: { payload: "act:more", text: "עוד" } };
    expect(parseNotification(notification([msg]), PHONE_NUMBER_ID).messages[0]?.content).toEqual({ type: "choice", id: "act:more", title: "עוד" });
  });

  it("marks images, voice notes, stickers etc. as unsupported", () => {
    const image = { from: USER_WA_ID, id: "wamid.I", timestamp: "1790000000", type: "image", image: { id: "media1", mime_type: "image/jpeg" } };
    const audio = { from: USER_WA_ID, id: "wamid.V", timestamp: "1790000000", type: "audio", audio: { id: "media2" } };
    expect(parseNotification(notification([image, audio]), PHONE_NUMBER_ID).messages.map((m) => m.content)).toEqual([
      { type: "unsupported", kind: "image" },
      { type: "unsupported", kind: "audio" },
    ]);
  });

  it("returns no messages for delivery/read status updates", () => {
    expect(parseNotification(statusUpdate(), PHONE_NUMBER_ID)).toEqual({ messages: [], skipped: 0 });
  });

  it("skips messages sent to a different business number", () => {
    expect(parseNotification(notification([textMessage("hi")], { phoneNumberId: "999" }), PHONE_NUMBER_ID)).toEqual({
      messages: [],
      skipped: 1,
    });
  });

  it("skips malformed messages but keeps valid ones", () => {
    const result = parseNotification(notification([{ id: "x" }, textMessage("ok")]), PHONE_NUMBER_ID);
    expect(result.skipped).toBe(1);
    expect(result.messages).toHaveLength(1);
  });

  it("throws for payloads that aren't WhatsApp notifications", () => {
    expect(() => parseNotification({ object: "page", entry: [] }, PHONE_NUMBER_ID)).toThrow();
  });
});

describe("toCloudApiMessage", () => {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to: USER_WA_ID };

  it("maps text", () => {
    expect(toCloudApiMessage(USER_WA_ID, { type: "text", body: "hi" })).toEqual({
      ...base,
      type: "text",
      text: { body: "hi", preview_url: false },
    });
  });

  it("maps buttons", () => {
    expect(toCloudApiMessage(USER_WA_ID, { type: "buttons", body: "b", buttons: [{ id: "a", title: "A" }] })).toEqual({
      ...base,
      type: "interactive",
      interactive: { type: "button", body: { text: "b" }, action: { buttons: [{ type: "reply", reply: { id: "a", title: "A" } }] } },
    });
  });

  it("maps lists", () => {
    const msg = toCloudApiMessage(USER_WA_ID, {
      type: "list",
      body: "b",
      buttonLabel: "בחירה",
      options: [{ id: "r1", title: "R1" }, { id: "r2", title: "R2", description: "d" }],
    });
    expect(msg).toEqual({
      ...base,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: "b" },
        action: { button: "בחירה", sections: [{ title: "אפשרויות", rows: [{ id: "r1", title: "R1" }, { id: "r2", title: "R2", description: "d" }] }] },
      },
    });
  });

  it("maps a product to an image with caption, or to text without an image", () => {
    expect(toCloudApiMessage(USER_WA_ID, { type: "product", caption: "c", imageUrl: "https://x.test/i.jpg" })).toEqual({
      ...base,
      type: "image",
      image: { link: "https://x.test/i.jpg", caption: "c" },
    });
    expect(toCloudApiMessage(USER_WA_ID, { type: "product", caption: "c" })).toEqual({
      ...base,
      type: "text",
      text: { body: "c", preview_url: false },
    });
  });
});

describe("WhatsApp client", () => {
  const msg = toCloudApiMessage(USER_WA_ID, { type: "text", body: "hi" });
  const make = (api: ReturnType<typeof fakeGraphApi>) =>
    createWhatsAppClient({
      accessToken: "SECRET-TOKEN",
      phoneNumberId: PHONE_NUMBER_ID,
      graphApiVersion: "v26.0",
      fetch: api.fetch,
      retryBaseDelayMs: 1,
    });

  it("posts to the right endpoint with the bearer token and returns the message id", async () => {
    const api = fakeGraphApi();
    expect(await make(api).send(msg)).toBe("wamid.OUT1");
    expect(api.calls[0]).toMatchObject({
      url: `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`,
      headers: { Authorization: "Bearer SECRET-TOKEN", "Content-Type": "application/json" },
      body: msg,
    });
  });

  it("retries rate limits and server errors, then succeeds", async () => {
    const api = fakeGraphApi((n) =>
      n === 1 ? { status: 429, body: { error: { code: 130429 } } }
      : n === 2 ? { status: 503, body: {} }
      : { status: 200, body: { messages: [{ id: "wamid.OK" }] } },
    );
    expect(await make(api).send(msg)).toBe("wamid.OK");
    expect(api.calls).toHaveLength(3);
  });

  it("gives up after the maximum attempts", async () => {
    const api = fakeGraphApi(() => ({ status: 500, body: {} }));
    await expect(make(api).send(msg)).rejects.toBeInstanceOf(WhatsAppApiError);
    expect(api.calls).toHaveLength(3);
  });

  it("does not retry permanent errors, and the error never contains the token", async () => {
    const api = fakeGraphApi(() => ({ status: 400, body: { error: { message: "Re-engagement message", code: 131047 } } }));
    const err = (await make(api).send(msg).catch((e) => e)) as WhatsAppApiError;
    expect(api.calls).toHaveLength(1);
    expect(err).toMatchObject({ status: 400, code: 131047, retryable: false });
    expect(JSON.stringify({ ...err, message: err.message })).not.toContain("SECRET-TOKEN");
  });

  it("retries network failures", async () => {
    let n = 0;
    const client = createWhatsAppClient({
      accessToken: "t",
      phoneNumberId: "1",
      graphApiVersion: "v26.0",
      retryBaseDelayMs: 1,
      fetch: (async () => {
        if (++n === 1) throw new TypeError("fetch failed");
        return new Response(JSON.stringify({ messages: [{ id: "wamid.N" }] }), { status: 200 });
      }) as typeof fetch,
    });
    expect(await client.send(msg)).toBe("wamid.N");
  });
});
