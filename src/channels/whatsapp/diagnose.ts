import type { Logger } from "../../logger.js";

export interface DiagnoseConfig {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
  /** Optional. When set, the app is also subscribed to this WhatsApp Business Account's webhooks. */
  businessAccountId?: string | undefined;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface GraphError {
  error?: { message?: string; code?: number; error_subcode?: number };
}

/** Meta's error text names no secrets, but keep it short in the logs. */
function describeError(body: unknown): string {
  const e = (body as GraphError | undefined)?.error;
  return e ? `${e.message ?? "unknown"} (code ${e.code ?? "?"})`.slice(0, 300) : "unknown error";
}

async function graph(
  fetchFn: FetchLike,
  cfg: DiagnoseConfig,
  path: string,
  method: "GET" | "POST",
): Promise<{ ok: boolean; body: unknown }> {
  const res = await fetchFn(`https://graph.facebook.com/${cfg.graphApiVersion}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.accessToken}` },
  });
  return { ok: res.ok, body: await res.json().catch(() => undefined) };
}

/**
 * Startup self-check. Logs whether the access token can see the phone number (and its last 4 digits,
 * to compare with the number in Meta's dashboard), and — when a business account id is given —
 * subscribes the app to that account's webhooks, which Meta requires before real messages are delivered.
 * Never throws: a failed check must not stop the server.
 */
export async function diagnoseWhatsApp(
  cfg: DiagnoseConfig,
  logger: Logger,
  fetchFn: FetchLike = fetch,
): Promise<void> {
  try {
    const phone = await graph(
      fetchFn,
      cfg,
      `${encodeURIComponent(cfg.phoneNumberId)}?fields=display_phone_number,verified_name,code_verification_status`,
      "GET",
    );
    if (phone.ok) {
      const b = phone.body as { display_phone_number?: string; verified_name?: string };
      const digits = (b.display_phone_number ?? "").replace(/\D/g, "");
      logger.log("info", "whatsapp.phone_check", {
        ok: true,
        numberEndsWith: digits.slice(-4) || undefined,
        verifiedName: b.verified_name,
      });
    } else {
      logger.log("error", "whatsapp.phone_check", { ok: false, error: describeError(phone.body) });
    }

    if (cfg.businessAccountId) {
      const path = `${encodeURIComponent(cfg.businessAccountId)}/subscribed_apps`;
      const sub = await graph(fetchFn, cfg, path, "POST");
      if (sub.ok) {
        const list = await graph(fetchFn, cfg, path, "GET");
        const apps = ((list.body as { data?: unknown[] } | undefined)?.data ?? []).length;
        logger.log("info", "whatsapp.subscribe", { ok: true, subscribedApps: apps });
      } else {
        logger.log("error", "whatsapp.subscribe", { ok: false, error: describeError(sub.body) });
      }
    }
  } catch (err) {
    logger.log("error", "whatsapp.diagnose_failed", { error: (err as Error).message });
  }
}
