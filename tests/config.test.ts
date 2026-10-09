import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses defaults when variables are missing", () => {
    expect(loadConfig({})).toEqual({ port: 3000, nodeEnv: "development", databaseUrl: undefined });
  });

  it("reads valid values", () => {
    expect(loadConfig({ PORT: "8080", NODE_ENV: "production" })).toEqual({
      port: 8080,
      nodeEnv: "production",
      databaseUrl: undefined,
    });
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/Invalid PORT/);
    expect(() => loadConfig({ PORT: "70000" })).toThrow(/Invalid PORT/);
  });

  it("rejects an invalid NODE_ENV", () => {
    expect(() => loadConfig({ NODE_ENV: "staging" })).toThrow(/Invalid NODE_ENV/);
  });

  it("accepts a postgres DATABASE_URL and treats an empty one as unset", () => {
    expect(loadConfig({ DATABASE_URL: "postgresql://u:p@localhost:5432/db" }).databaseUrl).toBe(
      "postgresql://u:p@localhost:5432/db",
    );
    expect(loadConfig({ DATABASE_URL: "  " }).databaseUrl).toBeUndefined();
  });

  it("rejects a non-postgres DATABASE_URL without leaking its value", () => {
    const secret = "mysql://user:SuperSecret@host/db";
    expect(() => loadConfig({ DATABASE_URL: secret })).toThrow(/Invalid DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: secret })).not.toThrow(/SuperSecret/);
  });
});
