import type { Queryable } from "./database.js";

export interface DatabaseStatus {
  /** Applied migration versions, oldest first. */
  migrations: string[];
  activeProducts: number;
  activeSampleProducts: number;
  approvedStores: number;
}

/** A quick, read-only snapshot used to confirm at startup that the schema and catalog are in place. */
export async function getDatabaseStatus(db: Queryable): Promise<DatabaseStatus> {
  const migrations = await db.query<{ version: string }>(
    "select version from giftbot_meta.schema_migrations order by version",
  );
  const counts = await db.query<{ active: number; sample: number; stores: number }>(
    `select
       (select count(*)::int from public.products where is_active) as active,
       (select count(*)::int from public.products where is_active and is_sample) as sample,
       (select count(*)::int from public.stores where approval_status = 'approved') as stores`,
  );
  const c = counts.rows[0]!;
  return {
    migrations: migrations.rows.map((r) => r.version),
    activeProducts: c.active,
    activeSampleProducts: c.sample,
    approvedStores: c.stores,
  };
}
