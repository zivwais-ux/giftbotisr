import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../../src/db/database.js";
import { applyMigrations } from "../../src/db/migrate.js";
import { createTestDatabase, resetTables } from "../db-helpers.js";

let db: Database;

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);
afterAll(async () => db?.close());
beforeEach(async () => resetTables(db));

async function insertStore(overrides: Record<string, unknown> = {}): Promise<string> {
  const row = {
    slug: "store",
    name: "Store",
    country: "IL",
    default_currency: "ILS",
    data_source: "test",
    approval_status: "pending",
    ...overrides,
  };
  const cols = Object.keys(row);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.stores (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    Object.values(row),
  );
  return rows[0]!.id;
}

async function insertProduct(storeId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const row = {
    store_id: storeId,
    external_id: "ext-1",
    name: "Product",
    price_amount: 100,
    price_currency: "ILS",
    product_url: "https://shop.test/p",
    availability: "in_stock",
    last_verified_at: new Date(),
    data_source: "test",
    ...overrides,
  };
  const cols = Object.keys(row);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.products (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    Object.values(row),
  );
  return rows[0]!.id;
}

describe("migrations", () => {
  it("are idempotent — a second run applies nothing", async () => {
    expect(await applyMigrations(db)).toEqual([]);
  });

  it("create all tables with row level security enabled", async () => {
    const { rows } = await db.query<{ tablename: string; rowsecurity: boolean }>(
      "select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename",
    );
    expect(rows.map((r) => r.tablename)).toEqual([
      "analytics_events",
      "conversations",
      "processed_messages",
      "product_attributes",
      "products",
      "recommendation_items",
      "recommendation_sessions",
      "stores",
      "users",
    ]);
    expect(rows.every((r) => r.rowsecurity)).toBe(true);
  });

  it("roll back a failing migration completely and don't record it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "giftbot-mig-"));
    await writeFile(
      join(dir, "29990101000000_broken.sql"),
      "create table public.should_not_exist (id int); select 1 / 0;",
    );
    await expect(applyMigrations(db, dir)).rejects.toThrow(/division by zero/);
    const { rows } = await db.query("select to_regclass('public.should_not_exist') as t");
    expect(rows[0]).toEqual({ t: null });
    const recorded = await db.query("select 1 from giftbot_meta.schema_migrations where version = '29990101000000'");
    expect(recorded.rows).toHaveLength(0);
  });

  it("reject badly named migration files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "giftbot-mig-"));
    await writeFile(join(dir, "add_stuff.sql"), "select 1;");
    await expect(applyMigrations(db, dir)).rejects.toThrow(/Invalid migration file name/);
  });
});

describe("stores constraints", () => {
  it("require a terms review before approval", async () => {
    await expect(insertStore({ approval_status: "approved" })).rejects.toThrow(/approved_store_terms_checked/);
  });

  it("require messaging links to be explicitly allowed before approval", async () => {
    await expect(
      insertStore({ approval_status: "approved", terms_reviewed_at: new Date(), allows_messaging_links: null }),
    ).rejects.toThrow(/approved_store_terms_checked/);
    await expect(
      insertStore({ approval_status: "approved", terms_reviewed_at: new Date(), allows_messaging_links: false }),
    ).rejects.toThrow(/approved_store_terms_checked/);
    await expect(
      insertStore({ approval_status: "approved", terms_reviewed_at: new Date(), allows_messaging_links: true }),
    ).resolves.toBeTypeOf("string");
  });

  it.each([
    ["bad slug", { slug: "Bad Slug" }],
    ["bad country", { country: "isr" }],
    ["unknown currency", { default_currency: "BTC" }],
    ["http website", { website_url: "http://shop.test" }],
    ["unknown status", { approval_status: "maybe" }],
  ])("reject %s", async (_label, override) => {
    await expect(insertStore(override)).rejects.toThrow();
  });
});

describe("products constraints", () => {
  it.each([
    ["non-https product url", { product_url: "http://shop.test/p" }],
    ["zero price", { price_amount: 0 }],
    ["unknown currency", { price_currency: "BTC" }],
    ["unknown availability", { availability: "maybe" }],
    ["commission over 100%", { affiliate_commission_rate: 1.5 }],
    ["delivery min > max", { delivery_min_days: 5, delivery_max_days: 2 }],
  ])("reject %s", async (_label, override) => {
    const storeId = await insertStore();
    await expect(insertProduct(storeId, override)).rejects.toThrow();
  });

  it("reject a duplicate external id within the same store", async () => {
    const storeId = await insertStore();
    await insertProduct(storeId);
    await expect(insertProduct(storeId)).rejects.toThrow(/products_store_external_unique/);
  });

  it("prevent deleting a store that still has products", async () => {
    const storeId = await insertStore();
    await insertProduct(storeId);
    await expect(db.query("delete from public.stores where id = $1", [storeId])).rejects.toThrow(/foreign key/);
  });

  it("keep updated_at current on update", async () => {
    const storeId = await insertStore();
    const id = await insertProduct(storeId);
    await db.query("update public.products set updated_at = now() - interval '1 day' where id = $1", [id]);
    await db.query("update public.products set name = 'Renamed' where id = $1", [id]);
    const { rows } = await db.query<{ fresh: boolean }>(
      "select updated_at > now() - interval '1 minute' as fresh from public.products where id = $1",
      [id],
    );
    expect(rows[0]!.fresh).toBe(true);
  });
});

describe("product_attributes constraints", () => {
  it.each([
    ["unknown occasion", "occasion", "party"],
    ["unknown recipient", "recipient", "boss"],
    ["unnormalized value", "interest", "Coffee"],
    ["unknown kind", "color", "red"],
  ])("reject %s", async (_label, kind, value) => {
    const productId = await insertProduct(await insertStore());
    await expect(
      db.query("insert into public.product_attributes (product_id, kind, value) values ($1, $2, $3)", [
        productId,
        kind,
        value,
      ]),
    ).rejects.toThrow();
  });

  it("are deleted together with their product", async () => {
    const productId = await insertProduct(await insertStore());
    await db.query("insert into public.product_attributes (product_id, kind, value) values ($1, 'interest', 'coffee')", [
      productId,
    ]);
    await db.query("delete from public.products where id = $1", [productId]);
    const { rows } = await db.query("select 1 from public.product_attributes");
    expect(rows).toHaveLength(0);
  });
});

describe("users, conversations and analytics constraints", () => {
  async function insertUser(whatsappId = "972501234567"): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      "insert into public.users (whatsapp_id) values ($1) returning id",
      [whatsappId],
    );
    return rows[0]!.id;
  }

  it("accept only digit WhatsApp ids, unique per user", async () => {
    await insertUser();
    await expect(insertUser()).rejects.toThrow(/unique/);
    await expect(insertUser("+972501234567")).rejects.toThrow();
  });

  it("allow only one active conversation per user", async () => {
    const userId = await insertUser();
    await db.query("insert into public.conversations (user_id) values ($1)", [userId]);
    await expect(db.query("insert into public.conversations (user_id) values ($1)", [userId])).rejects.toThrow(
      /conversations_one_active_per_user/,
    );
    await db.query("update public.conversations set status = 'completed' where user_id = $1", [userId]);
    await expect(db.query("insert into public.conversations (user_id) values ($1)", [userId])).resolves.toBeDefined();
  });

  it("reject unknown analytics event types and non-object properties", async () => {
    await expect(db.query("insert into public.analytics_events (event_type) values ('page_view')")).rejects.toThrow();
    await expect(
      db.query("insert into public.analytics_events (event_type, properties) values ('link_clicked', '[1]')"),
    ).rejects.toThrow();
    await expect(db.query("insert into public.analytics_events (event_type) values ('link_clicked')")).resolves.toBeDefined();
  });
});
