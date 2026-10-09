export type NodeEnv = "development" | "test" | "production";

export interface Config {
  port: number;
  nodeEnv: NodeEnv;
  /** Postgres connection string. Optional until a feature needs the database. Secret — never log it. */
  databaseUrl: string | undefined;
}

const NODE_ENVS: readonly NodeEnv[] = ["development", "test", "production"];

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

  return { port, nodeEnv: rawEnv as NodeEnv, databaseUrl };
}

/** Loads variables from a local .env file if one exists. Real environment variables take precedence. */
export function loadDotEnv(path = ".env"): void {
  try {
    process.loadEnvFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
