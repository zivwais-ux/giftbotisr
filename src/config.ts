/** "staging": a deployed test environment (may show sample data); "production": real users. */
export type NodeEnv = "development" | "test" | "staging" | "production";

export interface WhatsAppConfig {
  verifyToken: string;
  appSecret: string;
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
}

export interface Config {
  port: number;
  nodeEnv: NodeEnv;
  /** Postgres connection string. Optional until a feature needs the database. Secret — never log it. */
  databaseUrl: string | undefined;
  /** WhatsApp Cloud API settings; undefined when not configured. All values except the version are secret. */
  whatsapp: WhatsAppConfig | undefined;
  /** Serve ⚠️ sample products to users. For test environments only; refused in production. */
  allowSampleProducts: boolean;
}

/** Latest Graph API version confirmed at the time of writing (v26.0, July 2026). Override via env. */
export const DEFAULT_GRAPH_API_VERSION = "v26.0";

const WHATSAPP_VARS = {
  verifyToken: "WHATSAPP_VERIFY_TOKEN",
  appSecret: "WHATSAPP_APP_SECRET",
  accessToken: "WHATSAPP_ACCESS_TOKEN",
  phoneNumberId: "WHATSAPP_PHONE_NUMBER_ID",
} as const;

const NODE_ENVS: readonly NodeEnv[] = ["development", "test", "staging", "production"];

/**
 * Reads and validates configuration from environment variables.
 * Throws with a clear message on invalid values, so misconfiguration fails at startup.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawPort = env.PORT ?? "3000";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: "${rawPort}" (expected an integer between 1 and 65535)`);
  }

  const rawEnv = env.NODE_ENV ?? "development";
  if (!NODE_ENVS.includes(rawEnv as NodeEnv)) {
    throw new Error(`Invalid NODE_ENV: "${rawEnv}" (expected one of ${NODE_ENVS.join(", ")})`);
  }

  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  if (databaseUrl !== undefined && !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    // Don't echo the value: it may contain a password.
    throw new Error("Invalid DATABASE_URL (expected it to start with postgres:// or postgresql://)");
  }

  const nodeEnv = rawEnv as NodeEnv;
  const allowSampleProducts = env.ALLOW_SAMPLE_PRODUCTS?.trim().toLowerCase() === "true";
  if (allowSampleProducts && nodeEnv === "production") {
    throw new Error("ALLOW_SAMPLE_PRODUCTS=true is not allowed with NODE_ENV=production");
  }

  return { port, nodeEnv, databaseUrl, whatsapp: loadWhatsAppConfig(env), allowSampleProducts };
}

/** WhatsApp settings are all-or-nothing: a partial setup is a mistake worth failing loudly on. */
function loadWhatsAppConfig(env: NodeJS.ProcessEnv): WhatsAppConfig | undefined {
  const values = Object.fromEntries(
    Object.entries(WHATSAPP_VARS).map(([key, name]) => [key, env[name]?.trim() || undefined]),
  ) as Record<keyof typeof WHATSAPP_VARS, string | undefined>;
  const missing = Object.entries(WHATSAPP_VARS)
    .filter(([key]) => !values[key as keyof typeof WHATSAPP_VARS])
    .map(([, name]) => name);
  if (missing.length === Object.keys(WHATSAPP_VARS).length) return undefined;
  // Error messages name the variables, never their values.
  if (missing.length > 0) throw new Error(`Incomplete WhatsApp configuration. Missing: ${missing.join(", ")}`);

  if (values.verifyToken!.length < 16) throw new Error("WHATSAPP_VERIFY_TOKEN must be at least 16 characters");
  if (!/^\d+$/.test(values.phoneNumberId!)) throw new Error("WHATSAPP_PHONE_NUMBER_ID must contain digits only");
  const graphApiVersion = env.WHATSAPP_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION;
  if (!/^v\d+\.\d+$/.test(graphApiVersion)) throw new Error("WHATSAPP_GRAPH_API_VERSION must look like v26.0");

  return {
    verifyToken: values.verifyToken!,
    appSecret: values.appSecret!,
    accessToken: values.accessToken!,
    phoneNumberId: values.phoneNumberId!,
    graphApiVersion,
  };
}

/** Loads variables from a local .env file if one exists. Real environment variables take precedence. */
export function loadDotEnv(path = ".env"): void {
  try {
    process.loadEnvFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
