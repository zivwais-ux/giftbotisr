import { readFile } from "node:fs/promises";
import { z } from "zod";
import { STORE_APPROVAL_STATUSES, type StoreInput } from "../db/catalog-repository.js";
import { CountryCodeSchema, CurrencySchema, OCCASIONS, RECIPIENTS, ANY } from "../domain/types.js";

/**
 * One file per store (catalog/stores/<slug>.json): who the store is, the result of reviewing its
 * terms, and import defaults. Keeping this in version control documents *why* a store is allowed.
 */
export const StoreConfigSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().trim().min(1),
    country: CountryCodeSchema,
    currency: CurrencySchema,
    websiteUrl: z.url({ protocol: /^https$/ }),
    /** Where the product data comes from, e.g. "affiracle-feed", "direct-csv", "manual". */
    dataSource: z.string().trim().min(1),
    /** Affiliate network or "direct" partnership. */
    network: z.string().trim().min(1).optional(),
    terms: z.object({
      approvalStatus: z.enum(STORE_APPROVAL_STATUSES),
      /** Confirmed in the program terms that links may be shared in messaging apps (WhatsApp). null = not checked. */
      allowsMessagingLinks: z.boolean().nullable().optional(),
      allowsProductImages: z.boolean().nullable().optional(),
      requiresAffiliateDisclosure: z.boolean().nullable().optional(),
      termsUrl: z.url({ protocol: /^https$/ }).nullable().optional(),
      notes: z.string().nullable().optional(),
      /** null = not reviewed yet. (Never coerce null: it would become 1970-01-01, a fake review date.) */
      reviewedAt: z.coerce.date().nullable().optional(),
    }),
    /**
     * Builds the affiliate link from the product URL. Placeholders: {url} (URL-encoded product URL),
     * {rawUrl} (as-is). Example: "https://track.example.com/c?aff=123&url={url}".
     */
    affiliateLinkTemplate: z
      .string()
      .refine((t) => t.startsWith("https://") && /\{(url|rawUrl)\}/.test(t), {
        message: "must start with https:// and contain {url} or {rawUrl}",
      })
      .optional(),
    defaults: z
      .object({
        shipsTo: z.array(CountryCodeSchema).default([]),
        deliveryMinDays: z.number().int().nonnegative().optional(),
        deliveryMaxDays: z.number().int().nonnegative().optional(),
        occasions: z.array(z.union([z.enum(OCCASIONS), z.literal(ANY)])).min(1).default([ANY]),
        recipients: z.array(z.union([z.enum(RECIPIENTS), z.literal(ANY)])).min(1).default([ANY]),
      })
      .default({ shipsTo: [], occasions: [ANY], recipients: [ANY] }),
    isSample: z.boolean().default(false),
  })
  .refine((c) => c.terms.approvalStatus !== "approved" || (c.terms.reviewedAt && c.terms.allowsMessagingLinks === true), {
    message: "an approved store needs terms.reviewedAt and terms.allowsMessagingLinks: true",
    path: ["terms"],
  });

export type StoreConfig = z.infer<typeof StoreConfigSchema>;

export async function loadStoreConfig(path: string): Promise<StoreConfig> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  const parsed = StoreConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid store config ${path}:\n${issues}`);
  }
  return parsed.data;
}

export function toStoreInput(c: StoreConfig): StoreInput {
  return {
    slug: c.slug,
    name: c.name,
    country: c.country,
    defaultCurrency: c.currency,
    websiteUrl: c.websiteUrl,
    dataSource: c.dataSource,
    approvalStatus: c.terms.approvalStatus,
    allowsMessagingLinks: c.terms.allowsMessagingLinks ?? undefined,
    allowsProductImages: c.terms.allowsProductImages ?? undefined,
    requiresAffiliateDisclosure: c.terms.requiresAffiliateDisclosure ?? undefined,
    termsUrl: c.terms.termsUrl ?? undefined,
    termsNotes: c.terms.notes ?? undefined,
    termsReviewedAt: c.terms.reviewedAt ?? undefined,
    isSample: c.isSample,
  };
}

/** Applies the store's affiliate link template to a product URL. */
export function buildAffiliateUrl(template: string, productUrl: string): string {
  return template.replaceAll("{url}", encodeURIComponent(productUrl)).replaceAll("{rawUrl}", productUrl);
}
