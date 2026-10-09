import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses defaults when variables are missing", () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      nodeEnv: "development",
      databaseUrl: undefined,
      whatsapp: undefined,
      allowSampleProducts: false,
    });
  });

  it("reads valid values", () => {
    expect(loadConfig({ PORT: "8080", NODE_ENV: "production" })).toEqual({
      port: 8080,
      nodeEnv: "production",
      databaseUrl: undefined,
      whatsapp: undefined,
      allowSampleProducts: false,
    });
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/Invalid PORT/);
    expect(() => loadConfig({ PORT: "70000" })).toThrow(/Invalid PORT/);
  });

  it("rejects an invalid NODE_ENV", () => {
    expect(() => loadConfig({ NODE_ENV: "qa" })).toThrow(/Invalid NODE_ENV/);
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

  describe("WhatsApp", () => {
    const full = {
      WHATSAPP_VERIFY_TOKEN: "a-long-random-verify-token",
      WHATSAPP_APP_SECRET: "app-secret-value",
      WHATSAPP_ACCESS_TOKEN: "EAAG-secret-token",
      WHATSAPP_PHONE_NUMBER_ID: "123456789012345",
    };

    it("loads a complete configuration with the default API version", () => {
      expect(loadConfig(full).whatsapp).toEqual({
        verifyToken: full.WHATSAPP_VERIFY_TOKEN,
        appSecret: full.WHATSAPP_APP_SECRET,
        accessToken: full.WHATSAPP_ACCESS_TOKEN,
        phoneNumberId: full.WHATSAPP_PHONE_NUMBER_ID,
        graphApiVersion: "v26.0",
      });
      expect(loadConfig({ ...full, WHATSAPP_GRAPH_API_VERSION: "v27.0" }).whatsapp?.graphApiVersion).toBe("v27.0");
    });

    it("names missing variables without revealing any values", () => {
      const partial = { WHATSAPP_ACCESS_TOKEN: "EAAG-secret-token", WHATSAPP_APP_SECRET: "app-secret-value" };
      expect(() => loadConfig(partial)).toThrow("Missing: WHATSAPP_VERIFY_TOKEN, WHATSAPP_PHONE_NUMBER_ID");
      expect(() => loadConfig(partial)).not.toThrow(/EAAG|app-secret-value/);
    });

    it("validates the values", () => {
      expect(() => loadConfig({ ...full, WHATSAPP_VERIFY_TOKEN: "short" })).toThrow(/at least 16/);
      expect(() => loadConfig({ ...full, WHATSAPP_PHONE_NUMBER_ID: "+123" })).toThrow(/digits only/);
      expect(() => loadConfig({ ...full, WHATSAPP_GRAPH_API_VERSION: "latest" })).toThrow(/v26\.0/);
    });
  });

  it("allows sample products only outside production", () => {
    expect(loadConfig({ ALLOW_SAMPLE_PRODUCTS: "true" }).allowSampleProducts).toBe(true);
    expect(loadConfig({ ALLOW_SAMPLE_PRODUCTS: "true", NODE_ENV: "staging" }).allowSampleProducts).toBe(true);
    expect(() => loadConfig({ ALLOW_SAMPLE_PRODUCTS: "true", NODE_ENV: "production" })).toThrow(/not allowed/);
  });
});
