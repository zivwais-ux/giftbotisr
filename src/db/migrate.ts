import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./database.js";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

/** Supabase CLI naming: <14-digit timestamp>_<name>.sql */
const MIGRATION_FILE = /^(\d{14})_[a-z0-9_]+\.sql$/;

/**
 * Applies pending migrations in order, each in its own transaction, and records them in
 * `giftbot_meta.schema_migrations` (a schema Supabase's API doesn't expose).
 * For local development and tests; on hosted Supabase the same files can be applied with its tooling.
 */
export async function applyMigrations(db: Database, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(`
    create schema if not exists giftbot_meta;
    create table if not exists giftbot_meta.schema_migrations (
      version     text primary key,
      name        text not null,
      applied_at  timestamptz not null default now()
    );
  `);

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const invalid = files.filter((f) => !MIGRATION_FILE.test(f));
  if (invalid.length > 0) throw new Error(`Invalid migration file name(s): ${invalid.join(", ")}`);

  const { rows } = await db.query<{ version: string }>("select version from giftbot_meta.schema_migrations");
  const applied = new Set(rows.map((r) => r.version));

  const newlyApplied: string[] = [];
  for (const file of files) {
    const version = file.slice(0, 14);
    if (applied.has(version)) continue;
    const sql = await readFile(join(dir, file), "utf8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into giftbot_meta.schema_migrations (version, name) values ($1, $2)", [version, file]);
    });
    newlyApplied.push(file);
  }
  return newlyApplied;
}
