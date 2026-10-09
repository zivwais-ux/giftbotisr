import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEXTS } from "../../src/conversation/flow.js";
import { validateOutbound, type InboundContent, type OutboundMessage } from "../../src/conversation/messages.js";
import { ACTIONS } from "../../src/conversation/options.js";
import { DISCLOSURE } from "../../src/conversation/render.js";
import { SAMPLE_EXCHANGE_RATES, SAMPLE_REFERENCE_DATE } from "../../src/data/sample-products.js";
import { seedSampleCatalog } from "../../src/data/seed-sample.js";
import type { Database } from "../../src/db/database.js";
import { handleInboundMessage, type ConversationDeps } from "../../src/services/conversation-service.js";
import { createTestDatabase, resetTables } from "../db-helpers.js";

let db: Database;

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);
afterAll(async () => db?.close());
beforeEach(async () => {
  await resetTables(db);
  await seedSampleCatalog(db);
});

const DEPS: ConversationDeps = {
  getExchangeRates: () => SAMPLE_EXCHANGE_RATES,
  engineOptions: { allowSampleProducts: true },
};

const USER = "972501234567";
const tap = (id: string): InboundContent => ({ type: "choice", id });
const type = (text: string): InboundContent => ({ type: "text", text });

/** Scripted user: sends messages with unique ids and an advancing clock. */
function user(from = USER, deps = DEPS) {
  let seq = 0;
  let clock = SAMPLE_REFERENCE_DATE.getTime();
  return {
    async send(content: InboundContent, opts: { messageId?: string; advanceMs?: number } = {}) {
      clock += opts.advanceMs ?? 1000;
      const result = await handleInboundMessage(
        db,
        { messageId: opts.messageId ?? `${from}-${++seq}`, from, content, receivedAt: new Date(clock) },
        deps,
      );
      for (const m of result.messages) expect(validateOutbound(m), JSON.stringify(m)).toEqual([]);
      return result;
    },
  };
}

const COFFEE_FOR_COLLEAGUE = [tap("r:colleague"), tap("o:housewarming"), tap("b:300"), tap("i:coffee"), tap("a:none"), tap("d:none"), tap("x:yes")];

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

const products = (messages: OutboundMessage[]) =>
  messages.filter((m): m is Extract<OutboundMessage, { type: "product" }> => m.type === "product");

describe("a complete conversation", () => {
  it("goes from the first message to saved recommendations", async () => {
    const u = user();
    const first = await u.send(type("היי"));
    expect(first.messages[0]).toEqual({ type: "text", body: TEXTS.welcome });

    let last;
    for (const input of COFFEE_FOR_COLLEAGUE) last = await u.send(input);
    const shown = products(last!.messages);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown[0]!.caption).toContain("ערכת טעימות קפה");
    expect(shown.every((p) => p.caption.includes("⚠️ מוצר לדוגמה"))).toBe(true);
    expect(last!.messages.at(-1)).toMatchObject({ type: "buttons", buttons: [ACTIONS.more, ACTIONS.cheaper, ACTIONS.restart] });

    const [conversation] = await rows<{ status: string; step: string; collected: { resultsShown: boolean } }>(
      "select status, step, collected from public.conversations",
    );
    expect(conversation).toMatchObject({ status: "active", step: "results", collected: { resultsShown: true } });

    const [session] = await rows<{ result_count: number; conversation_id: string; user_id: string }>(
      "select result_count, conversation_id, user_id from public.recommendation_sessions",
    );
    expect(session!.result_count).toBe(shown.length);
    expect(session!.conversation_id).toBeTruthy();
    expect(session!.user_id).toBeTruthy();

    const events = await rows<{ event_type: string }>("select event_type from public.analytics_events order by id");
    expect(events.map((e) => e.event_type)).toEqual([
      "conversation_started",
      "recommendations_shown",
      "conversation_completed",
    ]);
  });

  it("stores the user once and no personal data in analytics", async () => {
    const u = user();
    await u.send(type("היי"));
    for (const input of COFFEE_FOR_COLLEAGUE) await u.send(input);
    expect(await rows("select whatsapp_id from public.users")).toEqual([{ whatsapp_id: USER }]);
    const props = await rows<{ p: string }>("select properties::text as p from public.analytics_events");
    expect(props.every((r) => !r.p.includes(USER))).toBe(true);
  });

  it("does not show sample products when sample data isn't allowed", async () => {
    const u = user(USER, { getExchangeRates: () => SAMPLE_EXCHANGE_RATES });
    await u.send(type("היי"));
    let last;
    for (const input of COFFEE_FOR_COLLEAGUE) last = await u.send(input);
    expect(products(last!.messages)).toEqual([]);
    expect(last!.messages.at(-1)).toMatchObject({ type: "buttons", buttons: [ACTIONS.restart] });
    expect((last!.messages.at(-1) as { body: string }).body).toContain("עדיין בבנייה");
  });
});

describe("after results", () => {
  async function toResults() {
    const u = user();
    await u.send(type("היי"));
    let last;
    for (const input of [tap("r:friend"), tap("o:birthday"), tap("b:500"), tap("i:none"), tap("a:none"), tap("d:none"), tap("x:yes")]) {
      last = await u.send(input);
    }
    return { u, first: last! };
  }

  it("'more' never repeats a product already shown", async () => {
    const { u, first } = await toResults();
    const firstNames = products(first.messages).map((p) => p.caption.split("\n")[0]!.replace(/^\*\d+\. /, ""));
    const more = await u.send(tap(ACTIONS.more.id));
    const moreNames = products(more.messages).map((p) => p.caption.split("\n")[0]!.replace(/^\*\d+\. /, ""));
    expect(moreNames.length).toBeGreaterThan(0);
    expect(moreNames.filter((n) => firstNames.includes(n))).toEqual([]);
  });

  it("eventually says honestly that there is nothing more", async () => {
    const { u } = await toResults();
    let reply;
    for (let i = 0; i < 6; i++) {
      reply = await u.send(tap(ACTIONS.more.id));
      if (products(reply.messages).length === 0) break;
    }
    expect(products(reply!.messages)).toEqual([]);
    expect(reply!.messages.some((m) => m.type === "buttons" && m.body.includes("לא מצאתי עוד אפשרויות"))).toBe(true);
    const events = await rows<{ event_type: string }>("select event_type from public.analytics_events where event_type = 'no_results'");
    expect(events.length).toBeGreaterThan(0);
  });

  it("'cheaper' only returns items under the lowered budget", async () => {
    const { u } = await toResults();
    const cheaper = await u.send(tap(ACTIONS.cheaper.id));
    const [session] = await rows<{ budget_max: string }>(
      "select budget_max::text from public.recommendation_sessions order by created_at desc limit 1",
    );
    expect(Number(session!.budget_max)).toBe(350);
    const [items] = await rows<{ max_price: string | null }>(
      `select max(i.shown_price_amount)::text as max_price from public.recommendation_items i
       join public.recommendation_sessions s on s.id = i.session_id
       where s.budget_max = 350`,
    );
    expect(products(cheaper.messages).length).toBeGreaterThan(0);
    expect(Number(items!.max_price)).toBeLessThanOrEqual(350 * 1.1); // within the 10% tolerance
  });
});

describe("no results", () => {
  it("offers the fix that addresses the main reason, and the fix works", async () => {
    const u = user();
    await u.send(type("היי"));
    let last;
    // Coffee lovers on a ₪50 budget: the only coffee item costs ₪160.
    for (const input of [tap("r:colleague"), tap("o:housewarming"), type("50"), tap("i:coffee"), tap("a:none"), tap("d:none"), tap("x:yes")]) {
      last = await u.send(input);
    }
    expect(products(last!.messages)).toEqual([]);
    const suggestion = last!.messages.at(-1);
    expect(suggestion).toMatchObject({ type: "buttons" });
    expect((suggestion as { buttons: { id: string }[] }).buttons[0]!.id).toBe(ACTIONS.raiseBudget.id);

    // Each raise is ×1.5, rounded to ₪10: 50 → 80 → 120 → 180. At ₪180 the ₪160 kit fits.
    expect(products((await u.send(tap(ACTIONS.raiseBudget.id))).messages)).toEqual([]);
    expect(products((await u.send(tap(ACTIONS.raiseBudget.id))).messages)).toEqual([]);
    const raised = await u.send(tap(ACTIONS.raiseBudget.id));
    const [conv] = await rows<{ collected: { answers: { budget: { max: number } } } }>(
      "select collected from public.conversations where status = 'active'",
    );
    expect(conv!.collected.answers.budget.max).toBe(180);
    expect(products(raised.messages)[0]!.caption).toContain("ערכת טעימות קפה");
  });
});

describe("reliability", () => {
  it("processes a duplicate delivery only once", async () => {
    const u = user();
    await u.send(type("היי"));
    const first = await u.send(tap("r:friend"), { messageId: "wamid.dup" });
    const second = await u.send(tap("r:parent"), { messageId: "wamid.dup" });
    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ messages: [], duplicate: true });
    const [conv] = await rows<{ collected: { answers: { recipient: string } } }>("select collected from public.conversations");
    expect(conv!.collected.answers.recipient).toBe("friend");
  });

  it("rolls back everything if processing fails — so a retry of the same message works", async () => {
    const failing = user(USER, { ...DEPS, getExchangeRates: () => { throw new Error("rates service down"); } });
    await failing.send(type("היי"));
    for (const input of COFFEE_FOR_COLLEAGUE.slice(0, -1)) await failing.send(input);
    await expect(failing.send(tap("x:yes"), { messageId: "wamid.retry" })).rejects.toThrow(/rates service down/);
    expect(await rows("select 1 from public.processed_messages where provider_message_id = 'wamid.retry'")).toEqual([]);
    expect(await rows("select 1 from public.recommendation_sessions")).toEqual([]);

    const retry = await handleInboundMessage(
      db,
      { messageId: "wamid.retry", from: USER, content: tap("x:yes"), receivedAt: new Date(SAMPLE_REFERENCE_DATE.getTime() + 60_000) },
      DEPS,
    );
    expect(products(retry.messages).length).toBeGreaterThan(0);
  });

  it("handles simultaneous messages from the same user one at a time", async () => {
    const u = user();
    await u.send(type("היי"));
    await Promise.all([u.send(tap("r:friend")), u.send(tap("o:birthday"))]);
    const [conv] = await rows<{ collected: { answers: Record<string, string> } }>("select collected from public.conversations");
    expect(conv!.collected.answers).toMatchObject({ recipient: "friend", occasion: "birthday" });
    expect(await rows("select 1 from public.conversations")).toHaveLength(1);
  });

  it("keeps different users' conversations separate", async () => {
    const a = user("972500000001");
    const b = user("972500000002");
    await a.send(type("היי"));
    await b.send(type("היי"));
    await a.send(tap("r:friend"));
    await b.send(tap("r:parent"));
    const convs = await rows<{ whatsapp_id: string; recipient: string }>(
      `select u.whatsapp_id, c.collected->'answers'->>'recipient' as recipient
       from public.conversations c join public.users u on u.id = c.user_id order by u.whatsapp_id`,
    );
    expect(convs).toEqual([
      { whatsapp_id: "972500000001", recipient: "friend" },
      { whatsapp_id: "972500000002", recipient: "parent" },
    ]);
  });

  it("recovers from corrupt stored state by starting over", async () => {
    const u = user();
    await u.send(type("היי"));
    await db.query("update public.conversations set collected = '{\"answers\": {\"recipient\": \"martian\"}}'");
    const reply = await u.send(tap("r:friend"));
    expect(reply.messages[0]).toEqual({ type: "text", body: TEXTS.welcome });
    expect(await rows<{ status: string }>("select status from public.conversations order by created_at")).toEqual([
      { status: "abandoned" },
      { status: "active" },
    ]);
  });
});

describe("lifecycle", () => {
  it("restart closes the conversation and starts a new one", async () => {
    const u = user();
    await u.send(type("היי"));
    await u.send(tap("r:friend"));
    const reply = await u.send(type("התחל מחדש"));
    expect(reply.messages[0]).toEqual({ type: "text", body: TEXTS.welcome });
    expect(await rows<{ status: string }>("select status from public.conversations order by created_at")).toEqual([
      { status: "abandoned" },
      { status: "active" },
    ]);
    const events = await rows<{ event_type: string }>("select event_type from public.analytics_events order by id");
    expect(events.map((e) => e.event_type)).toEqual(["conversation_started", "conversation_abandoned", "conversation_started"]);
  });

  it("restart after results marks the old conversation completed", async () => {
    const u = user();
    await u.send(type("היי"));
    for (const input of COFFEE_FOR_COLLEAGUE) await u.send(input);
    await u.send(tap(ACTIONS.restart.id));
    expect(await rows<{ status: string }>("select status from public.conversations order by created_at")).toEqual([
      { status: "completed" },
      { status: "active" },
    ]);
  });

  it("starts a new conversation after 24 hours of inactivity", async () => {
    const u = user();
    await u.send(type("היי"));
    await u.send(tap("r:friend"));
    const reply = await u.send(tap("o:birthday"), { advanceMs: 25 * 60 * 60 * 1000 });
    expect(reply.messages[0]).toEqual({ type: "text", body: TEXTS.welcome });
    expect(await rows<{ status: string }>("select status from public.conversations order by created_at")).toEqual([
      { status: "abandoned" },
      { status: "active" },
    ]);
  });

  it("continues the same conversation within 24 hours", async () => {
    const u = user();
    await u.send(type("היי"));
    await u.send(tap("r:friend"));
    const reply = await u.send(tap("o:birthday"), { advanceMs: 23 * 60 * 60 * 1000 });
    expect(reply.messages[0]).toMatchObject({ type: "buttons", body: expect.stringContaining("מה התקציב") });
  });
});

describe("opt-out", () => {
  it("stops all messages after 'הסר', until the user writes 'התחל'", async () => {
    const u = user();
    await u.send(type("היי"));
    const stop = await u.send(type("הסר"));
    expect(stop.messages).toEqual([{ type: "text", body: TEXTS.stopped }]);
    const [record] = await rows<{ opted_out_at: Date | null }>("select opted_out_at from public.users");
    expect(record!.opted_out_at).not.toBeNull();

    expect((await u.send(type("היי"))).messages).toEqual([]);
    expect((await u.send(tap("r:friend"))).messages).toEqual([]);

    const back = await u.send(type("התחל"));
    expect(back.messages[0]).toEqual({ type: "text", body: TEXTS.welcome });
    const [after] = await rows<{ opted_out_at: Date | null }>("select opted_out_at from public.users");
    expect(after!.opted_out_at).toBeNull();
  });
});

describe("affiliate disclosure", () => {
  it("is shown when a recommended product uses an affiliate link", async () => {
    await db.query("update public.products set affiliate_url = 'https://example.com/aff' where external_id = 'sample-coffee-tasting-kit'");
    const u = user();
    await u.send(type("היי"));
    let last;
    for (const input of COFFEE_FOR_COLLEAGUE) last = await u.send(input);
    const footer = last!.messages.at(-1) as { body: string };
    expect(footer.body).toContain(DISCLOSURE);
    expect(products(last!.messages)[0]!.caption).toContain("https://example.com/aff");
  });
});
