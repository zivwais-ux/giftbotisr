import pg from "pg";

/**
 * The minimal database surface the app needs. Production uses node-postgres (`pg`);
 * tests can plug in any Postgres-compatible implementation (e.g. PGlite).
 */
export interface Queryable {
  /** Runs one parameterized statement. Always pass user data via `params`, never by string concatenation. */
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
  /** Runs a multi-statement SQL script without parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface Database extends Queryable {
  /** Runs `fn` in a transaction: committed if it resolves, rolled back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Creates a connection pool for a Postgres URL (local Postgres or Supabase's direct connection string). */
export function createPgDatabase(connectionString: string, options: { ssl?: boolean } = {}): Database {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    ssl: options.ssl ? { rejectUnauthorized: true } : undefined,
  });

  const wrap = (client: pg.Pool | pg.PoolClient): Queryable => ({
    async query<R>(sql: string, params: unknown[] = []) {
      const result = await client.query(sql, params);
      return { rows: result.rows as R[] };
    },
    async exec(sql: string) {
      await client.query(sql);
    },
  });

  return {
    ...wrap(pool),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn(wrap(client));
        await client.query("commit");
        return result;
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
