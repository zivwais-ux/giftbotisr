import type { CloudApiMessage } from "./outbound.js";

export interface WhatsAppClientConfig {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
  /** Injected for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Total attempts for retryable failures (network errors, 429, 5xx). */
  maxAttempts?: number;
  /** Base delay for exponential backoff, in ms. */
  retryBaseDelayMs?: number;
  timeoutMs?: number;
}

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    /** Meta's error code (e.g. 131047 = outside the 24h customer service window). */
    readonly code: number | undefined,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

export interface WhatsAppClient {
  /** Sends one message. Resolves with WhatsApp's message id. */
  send(message: CloudApiMessage): Promise<string>;
}

export function createWhatsAppClient(config: WhatsAppClientConfig): WhatsAppClient {
  const doFetch = config.fetch ?? fetch;
  const maxAttempts = config.maxAttempts ?? 3;
  const baseDelay = config.retryBaseDelayMs ?? 500;
  const url = `https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(config.phoneNumberId)}/messages`;

  async function attempt(message: CloudApiMessage): Promise<string> {
    let response: Response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
      });
    } catch (err) {
      throw new WhatsAppApiError(`Network error: ${(err as Error).message}`, undefined, undefined, true);
    }

    const body = (await response.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };
    if (response.ok && body.messages?.[0]?.id) return body.messages[0].id;

    const retryable = response.status === 429 || response.status >= 500;
    // Meta's error message never contains our token; still, don't include request headers.
    throw new WhatsAppApiError(
      `WhatsApp API ${response.status}: ${body.error?.message ?? "unexpected response"}`,
      response.status,
      body.error?.code,
      retryable,
    );
  }

  return {
    async send(message) {
      for (let i = 1; ; i++) {
        try {
          return await attempt(message);
        } catch (err) {
          const retryable = err instanceof WhatsAppApiError && err.retryable;
          if (!retryable || i >= maxAttempts) throw err;
          await sleep(baseDelay * 2 ** (i - 1));
        }
      }
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
