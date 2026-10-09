export type NodeEnv = "development" | "test" | "production";

export interface Config {
  port: number;
  nodeEnv: NodeEnv;
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

  return { port, nodeEnv: rawEnv as NodeEnv };
}
