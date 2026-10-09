import { z } from "zod";

/**
 * Core domain model for GiftBot.
 *
 * Schemas are the single source of truth: TypeScript types are inferred from them,
 * and the same schemas validate data at system boundaries (catalog import, AI output,
 * webhook input) so invalid data never reaches the recommendation engine.
 */

export const CURRENCIES = ["ILS", "USD", "EUR", "GBP"] as const;
export const CurrencySchema = z.enum(CURRENCIES);
export type Currency = z.infer<typeof CurrencySchema>;

/** ISO 3166-1 alpha-2 country code, e.g. "IL", "US". */
export const CountryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, "Expected an ISO 3166-1 alpha-2 country code (e.g. IL)");
export type CountryCode = z.infer<typeof CountryCodeSchema>;

export const OCCASIONS = [
  "birthday",
  "anniversary",
  "wedding",
  "birth",
  "holiday",
  "housewarming",
  "graduation",
  "thank_you",
  "other",
] as const;
export const OccasionSchema = z.enum(OCCASIONS);
export type Occasion = z.infer<typeof OccasionSchema>;

export const RECIPIENTS = [
  "partner",
  "parent",
  "grandparent",
  "sibling",
  "child",
  "teen",
  "baby",
  "friend",
  "colleague",
  "other",
] as const;
export const RecipientSchema = z.enum(RECIPIENTS);
export type Recipient = z.infer<typeof RecipientSchema>;

/** Marks a product as suitable for every occasion / recipient (a weaker match than an explicit one). */
export const ANY = "any" as const;

export const AVAILABILITY = ["in_stock", "out_of_stock", "unknown"] as const;
export const AvailabilitySchema = z.enum(AVAILABILITY);
export type Availability = z.infer<typeof AvailabilitySchema>;

/**
 * Free-form tag (interest or category), stored normalized: lowercase, trimmed, single spaces.
 * Mapping a user's free text to tags is the job of the conversation/AI layer, not the engine.
 */
export const TagSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .transform((s) => normalizeTag(s));

export function normalizeTag(value: string): string {
  return value.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

export const MoneySchema = z.object({
  amount: z.number().finite().positive(),
  currency: CurrencySchema,
});
export type Money = z.infer<typeof MoneySchema>;

const HttpsUrlSchema = z.url({ protocol: /^https$/ });

export const ShippingSchema = z
  .object({
    /** Countries the store ships to. Empty means unknown. */
    shipsTo: z.array(CountryCodeSchema).default([]),
    /** Delivery estimate in calendar days, when the source provides one. */
    minDays: z.number().int().nonnegative().optional(),
    maxDays: z.number().int().nonnegative().optional(),
  })
  .refine((s) => s.minDays === undefined || s.maxDays === undefined || s.minDays <= s.maxDays, {
    message: "minDays must be <= maxDays",
  });
export type Shipping = z.infer<typeof ShippingSchema>;

export const ProductSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().default(""),
  price: MoneySchema,
  imageUrl: HttpsUrlSchema.optional(),
  productUrl: HttpsUrlSchema,
  affiliateUrl: HttpsUrlSchema.optional(),
  /**
   * Stored for business reporting only. The recommendation engine deliberately never reads it:
   * commission must not influence relevance or ordering.
   */
  affiliateCommissionRate: z.number().min(0).max(1).optional(),
  storeId: z.string().min(1),
  storeCountry: CountryCodeSchema,
  availability: AvailabilitySchema,
  shipping: ShippingSchema.optional(),
  categories: z.array(TagSchema).min(1),
  interests: z.array(TagSchema).default([]),
  occasions: z.array(z.union([OccasionSchema, z.literal(ANY)])).min(1),
  recipients: z.array(z.union([RecipientSchema, z.literal(ANY)])).min(1),
  /** When price/availability were last verified against the source. */
  lastVerifiedAt: z.coerce.date(),
  /** Where the data came from (feed name, API, manual entry...). */
  dataSource: z.string().min(1),
  /** True for clearly-marked demo data. Sample products are never shown unless explicitly allowed. */
  isSample: z.boolean().default(false),
});
export type Product = z.infer<typeof ProductSchema>;
export type ProductInput = z.input<typeof ProductSchema>;

export const BudgetSchema = z
  .object({
    min: z.number().finite().nonnegative().optional(),
    max: z.number().finite().positive(),
    currency: CurrencySchema,
  })
  .refine((b) => b.min === undefined || b.min <= b.max, { message: "budget.min must be <= budget.max" });
export type Budget = z.infer<typeof BudgetSchema>;

export const GiftRequestSchema = z.object({
  recipient: RecipientSchema,
  occasion: OccasionSchema,
  budget: BudgetSchema,
  interests: z.array(TagSchema).default([]),
  /** Things to avoid (e.g. "alcohol"). Matched against product tags and name words. */
  avoid: z.array(TagSchema).default([]),
  /** Date the gift is needed by (delivery must arrive by then). */
  neededBy: z.coerce.date().optional(),
  deliveryCountry: CountryCodeSchema.default("IL"),
  allowInternationalShipping: z.boolean().default(true),
});
export type GiftRequest = z.infer<typeof GiftRequestSchema>;
export type GiftRequestInput = z.input<typeof GiftRequestSchema>;

export function parseProduct(input: unknown): Product {
  return ProductSchema.parse(input);
}

export function parseGiftRequest(input: unknown): GiftRequest {
  return GiftRequestSchema.parse(input);
}
