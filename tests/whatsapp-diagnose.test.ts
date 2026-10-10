import { describe, expect, it } from "vitest";
import { diagnoseWhatsApp } from "../src/channels/whatsapp/diagnose.js";
import type { Logger } from "../src/logger.js";

const cfg = { accessToken: "SECRET-TOKEN", phoneNumberId: "123", graphApiVersion: "v26.0", businessAccountId: "999" };

function setup(responses: Record<string, { ok: boolean; body: unknown }>) {
  const logs: { level: string; event: string; fields?: Record<string, unknown> }[] = [];
  const logger: Logger = { log: (level, event, fields) => void logs.push({ level, event, fields }) };
  const calls: string[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    const key = `${init?.method} ${url.split("/").slice(4).join("/").split("?")[0]}`;
    calls.push(key);
    const r = responses[key] ?? { ok: false, body: { error: { message: "unexpected", code: 1 } } };
    return { ok: r.ok, json: async () => r.body } as Response;
  };
  return { logs, logger, calls, fetchFn };
}

describe("diagnoseWhatsApp", () => {
  it("logs the last 4 digits of the number and subscribes the app", async () => {
    const t = setup({
      "GET 123": { ok: true, body: { display_phone_number: "+1 555-653-0308", verified_name: "Test" } },
      "POST 999/subscribed_apps": { ok: true, body: { success: true } },
      "GET 999/subscribed_apps": { ok: true, body: { data: [{}] } },
    });
    await diagnoseWhatsApp(cfg, t.logger, t.fetchFn);
    expect(t.logs.find((l) => l.event === "whatsapp.phone_check")?.fields).toMatchObject({ ok: true, numberEndsWith: "0308" });
    expect(t.logs.find((l) => l.event === "whatsapp.subscribe")?.fields).toMatchObject({ ok: true, subscribedApps: 1 });
    expect(JSON.stringify(t.logs)).not.toContain("SECRET-TOKEN");
  });

  it("logs Meta's error and never throws", async () => {
    const t = setup({ "GET 123": { ok: false, body: { error: { message: "Invalid OAuth access token", code: 190 } } } });
    await diagnoseWhatsApp({ ...cfg, businessAccountId: undefined }, t.logger, t.fetchFn);
    expect(t.logs[0]).toMatchObject({ level: "error", event: "whatsapp.phone_check" });
    expect(t.logs[0]!.fields!.error).toContain("190");
    expect(t.calls).toEqual(["GET 123"]);
  });

  it("survives a network failure", async () => {
    const t = setup({});
    await diagnoseWhatsApp(cfg, t.logger, async () => {
      throw new Error("offline");
    });
    expect(t.logs[0]).toMatchObject({ event: "whatsapp.diagnose_failed" });
  });
});
