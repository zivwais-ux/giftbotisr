import { SAMPLE_REFERENCE_DATE } from "../../../src/data/sample-products.js";

/** Webhook payloads in the WhatsApp Cloud API format, for tests. */
export const PHONE_NUMBER_ID = "106540352242922";
export const APP_SECRET = "test-app-secret";
export const VERIFY_TOKEN = "test-verify-token-123456";
export const USER_WA_ID = "972501234567";

/** Message time: one hour after the sample catalog was "verified", so sample data is fresh. */
export const TIMESTAMP = String(Math.floor(SAMPLE_REFERENCE_DATE.getTime() / 1000) + 3600);

let counter = 0;
const nextId = () => `wamid.TEST${String(++counter).padStart(6, "0")}`;

export function notification(messages: unknown[], opts: { phoneNumberId?: string } = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550783881", phone_number_id: opts.phoneNumberId ?? PHONE_NUMBER_ID },
              contacts: [{ profile: { name: "Test User" }, wa_id: USER_WA_ID }],
              messages,
            },
          },
        ],
      },
    ],
  };
}

export function textMessage(body: string, opts: { from?: string; id?: string; timestamp?: number } = {}) {
  return {
    from: opts.from ?? USER_WA_ID,
    id: opts.id ?? nextId(),
    timestamp: opts.timestamp !== undefined ? String(opts.timestamp) : TIMESTAMP,
    type: "text",
    text: { body },
  };
}

export function buttonReply(id: string, title = "x", opts: { from?: string; msgId?: string } = {}) {
  return {
    from: opts.from ?? USER_WA_ID,
    id: opts.msgId ?? nextId(),
    timestamp: TIMESTAMP,
    type: "interactive",
    interactive: { type: "button_reply", button_reply: { id, title } },
  };
}

export function listReply(id: string, title = "x", opts: { from?: string } = {}) {
  return {
    from: opts.from ?? USER_WA_ID,
    id: nextId(),
    timestamp: TIMESTAMP,
    type: "interactive",
    interactive: { type: "list_reply", list_reply: { id, title, description: "" } },
  };
}

export function statusUpdate() {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550783881", phone_number_id: PHONE_NUMBER_ID },
              statuses: [{ id: "wamid.OUT1", status: "delivered", timestamp: "1790000001", recipient_id: USER_WA_ID }],
            },
          },
        ],
      },
    ],
  };
}

/** A fake Graph API: records every request and answers like Meta does. */
export function fakeGraphApi(respond?: (call: number) => { status: number; body: unknown }) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, any> }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    const r = respond?.(calls.length) ?? { status: 200, body: { messages: [{ id: `wamid.OUT${calls.length}` }] } };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetch: fetchImpl };
}
