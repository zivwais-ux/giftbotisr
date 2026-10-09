import { PGlite } from "@electric-sql/pglite";
import { createPgDatabase, type Database, type Queryable } from "../src/db/database.js";
import { applyMigrations } from "../src/db/migrate.js";

/**
 * Creates a migrated test database.
 * Default: in-process PGlite (real Postgres compiled to WASM) — no server needed.
 * If TEST_DATABASE_URL is set, uses that real Postgres instead. It is WIPED, so its
 * database name must contain "test".
 */
export async function createTestDatabase(): Promise<Database> {
  const url = process.env.TEST_DATABASE_URL;
  let db: Database;
  if (url) {
    const dbName = new URL(url).pathname.slice(1);
    if (!dbName.includes("test")) {
      throw new Error(`Refusing to wipe database "${dbName}": TEST_DATABASE_URL must point to a *test* database`);
    }
    db = createPgDatabase(url);
    await db.exec(`
      drop schema if exists giftbot_meta cascade;
      drop schema public cascade;
      create schema public;
    `);
  } else {
    db = createPgliteDatabase(new PGlite());
  }
  await applyMigrations(db);
  return db;
}

function createPgliteDatabase(pglite: PGlite): Database {
  const wrap = (client: Pick<PGlite, "query" | "exec">): Queryable => ({
    async query<R>(sql: string, params: unknown[] = []) {
      const result = await client.query<R>(sql, params);
      return { rows: result.rows };
    },
    async exec(sql: string) {
      await client.exec(sql);
    },
  });
  return {
    ...wrap(pglite),
    transaction: (fn) => pglite.transaction((tx) => fn(wrap(tx))),
    close: () => pglite.close(),
  };
}

const ALL_TABLES = [
  "processed_messages",
  "analytics_events",
  "recommendation_items",
  "recommendation_sessions",
  "conversations",
  "users",
  "product_attributes",
  "products",
  "stores",
].map((t) => `public.${t}`);

/** Empties all app tables between tests (keeps the schema). */
export async function resetTables(db: Database): Promise<void> {
  await db.exec(`truncate ${ALL_TABLES.join(", ")} restart identity cascade`);
}
