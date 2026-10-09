import { z } from "zod";
import {
  CountryCodeSchema,
  CurrencySchema,
  ProductSchema,
  type Product,
  type ProductInput,
} from "../domain/types.js";
import type { Database, Queryable } from "./database.js";

export const STORE_APPROVAL_STATUSES = ["pending", "approved", "rejected", "suspended"] as const;

export const StoreInputSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().trim().min(1),
  country: CountryCodeSchema,
  defaultCurrency: CurrencySchema,
  websiteUrl: z.url({ protocol: /^https$/ }).optional(),
  dataSource: z.string().trim().min(1),
  approvalStatus: z.enum(STORE_APPROVAL_STATUSES).default("pending"),
  allowsMessagingLinks: z.boolean().optional(),
  allowsProductImages: z.boolean().optional(),
  requiresAffiliateDisclosure: z.boolean().optional(),
  termsUrl: z.url({ protocol: /^https$/ }).optional(),
  termsNotes: z.string().optional(),
  termsReviewedAt: z.coerce.date().optional(),
  isSample: z.boolean().default(false),
});
export type StoreInput = z.input<typeof StoreInputSchema>;

/** A product as imported from a source: identified by its id in that source, belonging to a store. */
export const CatalogProductSchema = ProductSchema.omit({ id: true, storeId: true, storeCountry: true }).extend({
  externalId: z.string().min(1),
});
export type CatalogProductInput = z.input<typeof CatalogProductSchema>;

/** Creates or updates a store by slug. Returns its id. */
export async function upsertStore(db: Queryable, input: StoreInput): Promise<string> {
  const s = StoreInputSchema.parse(input);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.stores (
       slug, name, country, default_currency, website_url, data_source, approval_status,
       allows_messaging_links, allows_product_images, requires_affiliate_disclosure,
       terms_url, terms_notes, terms_reviewed_at, is_sample
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict (slug) do update set
       name = excluded.name,
       country = excluded.country,
       default_currency = excluded.default_currency,
       website_url = excluded.website_url,
       data_source = excluded.data_source,
       approval_status = excluded.approval_status,
       allows_messaging_links = excluded.allows_messaging_links,
       allows_product_images = excluded.allows_product_images,
       requires_affiliate_disclosure = excluded.requires_affiliate_disclosure,
       terms_url = excluded.terms_url,
       terms_notes = excluded.terms_notes,
       terms_reviewed_at = excluded.terms_reviewed_at,
       is_sample = excluded.is_sample
     returning id`,
    [
      s.slug,
      s.name,
      s.country,
      s.defaultCurrency,
      s.websiteUrl ?? null,
      s.dataSource,
      s.approvalStatus,
      s.allowsMessagingLinks ?? null,
      s.allowsProductImages ?? null,
      s.requiresAffiliateDisclosure ?? null,
      s.termsUrl ?? null,
      s.termsNotes ?? null,
      s.termsReviewedAt ?? null,
      s.isSample,
    ],
  );
  return rows[0]!.id;
}

/**
 * Creates or updates a product by (store, externalId), replacing its attributes atomically.
 * Re-importing the same feed is safe (idempotent). Returns the product id.
 */
export async function upsertProduct(db: Database, storeId: string, input: CatalogProductInput): Promise<string> {
  const p = CatalogProductSchema.parse(input);
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `insert into public.products (
         store_id, external_id, name, description, price_amount, price_currency, image_url, product_url,
         affiliate_url, affiliate_commission_rate, availability, ships_to, delivery_min_days, delivery_max_days,
         last_verified_at, data_source, is_sample, is_active
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, true)
       on conflict (store_id, external_id) do update set
         name = excluded.name,
         description = excluded.description,
         price_amount = excluded.price_amount,
         price_currency = excluded.price_currency,
         image_url = excluded.image_url,
         product_url = excluded.product_url,
         affiliate_url = excluded.affiliate_url,
         affiliate_commission_rate = excluded.affiliate_commission_rate,
         availability = excluded.availability,
         ships_to = excluded.ships_to,
         delivery_min_days = excluded.delivery_min_days,
         delivery_max_days = excluded.delivery_max_days,
         last_verified_at = excluded.last_verified_at,
         data_source = excluded.data_source,
         is_sample = excluded.is_sample,
         is_active = true
       returning id`,
      [
        storeId,
        p.externalId,
        p.name,
        p.description,
        p.price.amount,
        p.price.currency,
        p.imageUrl ?? null,
        p.productUrl,
        p.affiliateUrl ?? null,
        p.affiliateCommissionRate ?? null,
        p.availability,
        p.shipping?.shipsTo ?? [],
        p.shipping?.minDays ?? null,
        p.shipping?.maxDays ?? null,
        p.lastVerifiedAt,
        p.dataSource,
        p.isSample,
      ],
    );
    const productId = rows[0]!.id;

    const attributes = [
      ...p.categories.map((value, position) => ({ kind: "category", value, position })),
      ...p.interests.map((value, position) => ({ kind: "interest", value, position })),
      ...p.occasions.map((value, position) => ({ kind: "occasion", value, position })),
      ...p.recipients.map((value, position) => ({ kind: "recipient", value, position })),
    ];
    await tx.query("delete from public.product_attributes where product_id = $1", [productId]);
    await tx.query(
      `insert into public.product_attributes (product_id, kind, value, position)
       select $1, kind, value, position
       from unnest($2::text[], $3::text[], $4::smallint[]) as a(kind, value, position)
       on conflict do nothing`,
      [productId, attributes.map((a) => a.kind), attributes.map((a) => a.value), attributes.map((a) => a.position)],
    );
    return productId;
  });
}

/** Marks a product inactive (kept for audit of past recommendations). */
export async function deactivateProduct(db: Queryable, productId: string): Promise<void> {
  await db.query("update public.products set is_active = false where id = $1", [productId]);
}

interface ProductRow {
  id: string;
  store_id: string;
  store_country: string;
  allows_product_images: boolean | null;
  name: string;
  description: string;
  price_amount: number;
  price_currency: string;
  image_url: string | null;
  product_url: string;
  affiliate_url: string | null;
  affiliate_commission_rate: number | null;
  availability: string;
  ships_to: string[];
  delivery_min_days: number | null;
  delivery_max_days: number | null;
  last_verified_at: Date | string;
  data_source: string;
  is_sample: boolean;
  categories: string[];
  interests: string[];
  occasions: string[];
  recipients: string[];
}

export interface LoadedCatalog {
  products: Product[];
  /** Rows that failed validation; skipped rather than crashing the request. Should be monitored. */
  invalid: { productId: string; issues: string[] }[];
}

/**
 * Loads products eligible for recommendation: active, from approved stores whose terms allow
 * sending links over messaging. Images are dropped for stores that haven't allowed their use.
 * Sample data is excluded unless `includeSample` is true.
 */
export async function loadActiveProducts(
  db: Queryable,
  { includeSample = false }: { includeSample?: boolean } = {},
): Promise<LoadedCatalog> {
  const { rows } = await db.query<ProductRow>(
    `select
       p.id, p.store_id, s.country::text as store_country, s.allows_product_images,
       p.name, p.description,
       p.price_amount::float8 as price_amount, p.price_currency,
       p.image_url, p.product_url, p.affiliate_url,
       p.affiliate_commission_rate::float8 as affiliate_commission_rate,
       p.availability, p.ships_to::text[] as ships_to, p.delivery_min_days, p.delivery_max_days,
       p.last_verified_at, p.data_source, p.is_sample,
       ${attributeArray("category")} as categories,
       ${attributeArray("interest")} as interests,
       ${attributeArray("occasion")} as occasions,
       ${attributeArray("recipient")} as recipients
     from public.products p
     join public.stores s on s.id = p.store_id
     where p.is_active
       and s.approval_status = 'approved'
       and s.allows_messaging_links is true
       and ($1::boolean or (not p.is_sample and not s.is_sample))
     order by p.id`,
    [includeSample],
  );

  const products: Product[] = [];
  const invalid: LoadedCatalog["invalid"] = [];
  for (const row of rows) {
    const parsed = ProductSchema.safeParse(rowToProductInput(row));
    if (parsed.success) {
      products.push(parsed.data);
    } else {
      invalid.push({
        productId: row.id,
        issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
      });
    }
  }
  return { products, invalid };
}

function attributeArray(kind: "category" | "interest" | "occasion" | "recipient"): string {
  return `coalesce((
    select array_agg(a.value order by a.position, a.value)
    from public.product_attributes a
    where a.product_id = p.id and a.kind = '${kind}'
  ), '{}'::text[])`;
}

function rowToProductInput(row: ProductRow): ProductInput {
  const hasShipping = row.ships_to.length > 0 || row.delivery_min_days !== null || row.delivery_max_days !== null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: { amount: Number(row.price_amount), currency: row.price_currency as ProductInput["price"]["currency"] },
    imageUrl: row.allows_product_images === true ? (row.image_url ?? undefined) : undefined,
    productUrl: row.product_url,
    affiliateUrl: row.affiliate_url ?? undefined,
    affiliateCommissionRate: row.affiliate_commission_rate ?? undefined,
    storeId: row.store_id,
    storeCountry: row.store_country,
    availability: row.availability as ProductInput["availability"],
    shipping: hasShipping
      ? {
          shipsTo: row.ships_to,
          minDays: row.delivery_min_days ?? undefined,
          maxDays: row.delivery_max_days ?? undefined,
        }
      : undefined,
    categories: row.categories,
    interests: row.interests,
    occasions: row.occasions as ProductInput["occasions"],
    recipients: row.recipients as ProductInput["recipients"],
    lastVerifiedAt: new Date(row.last_verified_at),
    dataSource: row.data_source,
    isSample: row.is_sample,
  };
}
