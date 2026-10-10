import type { Server } from "node:http";
import { createApp, type AppDeps } from "./app.js";
import { diagnoseWhatsApp } from "./channels/whatsapp/diagnose.js";
import { createWhatsAppClient } from "./channels/whatsapp/client.js";
import { loadConfig, loadDotEnv, type Config } from "./config.js";
import { createPgDatabase, type Database } from "./db/database.js";
import { getDatabaseStatus } from "./db/status.js";
import type { ExchangeRates } from "./domain/money.js";
import { consoleLogger as logger } from "./logger.js";
import { handleInboundMessage } from "./services/conversation-service.js";

loadDotEnv();

/** Reads and validates the configuration; on a mistake, logs exactly which setting is wrong and exits. */
function loadConfigOrExit(): Config {
  try {
    return loadConfig();
  } catch (err) {
    // Messages name the setting, never its value.
    logger.log("error", "config.invalid", { error: (err as Error).message });
    process.exit(1);
  }
}
const config = loadConfigOrExit();

/**
 * No real exchange-rate source is connected yet. An empty table means foreign-currency products
 * are excluded rather than priced with invented rates.
 */
const NO_EXCHANGE_RATES: ExchangeRates = { toIls: {}, asOf: new Date(0) };

const background = new Set<Promise<void>>();
let db: Database | undefined;

if (config.databaseUrl) db = createPgDatabase(config.databaseUrl);

/** Logs schema and catalog state at startup, so deploy logs show whether the release step worked. */
async function logDatabaseStatus(database: Database): Promise<void> {
  try {
    logger.log("info", "database.status", { ...(await getDatabaseStatus(database)) });
  } catch (err) {
    logger.log("error", "database.unavailable", { error: (err as Error).message });
  }
}

function buildDeps(cfg: Config): AppDeps {
  if (!cfg.whatsapp) {
    logger.log("info", "whatsapp.disabled", { reason: "WHATSAPP_* variables not set" });
    return {};
  }
  if (!db) throw new Error("WhatsApp is configured but DATABASE_URL is not set");
  const database = db;
  if (cfg.allowSampleProducts) logger.log("warn", "sample_products.enabled");
  logger.log("warn", "exchange_rates.unavailable", { effect: "foreign-currency products are excluded" });

  return {
    whatsapp: {
      verifyToken: cfg.whatsapp.verifyToken,
      appSecret: cfg.whatsapp.appSecret,
      phoneNumberId: cfg.whatsapp.phoneNumberId,
      client: createWhatsAppClient(cfg.whatsapp),
      processMessage: (inbound) =>
        handleInboundMessage(database, inbound, {
          getExchangeRates: () => NO_EXCHANGE_RATES,
          engineOptions: { allowSampleProducts: cfg.allowSampleProducts },
        }),
      logger,
      trackBackground: (task) => {
        background.add(task);
        void task.finally(() => background.delete(task));
      },
    },
  };
}

const server: Server = createApp(buildDeps(config));
if (db) void logDatabaseStatus(db);
if (config.whatsapp) void diagnoseWhatsApp(config.whatsapp, logger);
server.listen(config.port, () => {
  logger.log("info", "server.started", { port: config.port, env: config.nodeEnv, whatsapp: Boolean(config.whatsapp) });
});

/** On shutdown: stop accepting requests, finish sending pending replies, close the database. */
async function shutdown(signal: string): Promise<void> {
  logger.log("info", "server.stopping", { signal });
  server.close();
  await Promise.allSettled([...background]);
  await db?.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
