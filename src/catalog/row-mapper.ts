import { CatalogProductSchema, type CatalogProductInput } from "../db/catalog-repository.js";
import { normalizeTag, type Availability, type Currency } from "../domain/types.js";
import type { FeedRow } from "./feed-parsers.js";
import { buildAffiliateUrl, type StoreConfig } from "./store-config.js";
import { inferTags } from "./tagger.js";

/** Accepted column names per field (normalized: lowercase, underscores). First non-empty wins. */
const COLUMNS = {
  id: ["id", "sku", "external_id", "item_id", "מזהה", "מקט", 'מק"ט'],
  name: ["title", "name", "product_name", "שם", "שם_מוצר"],
  description: ["description", "short_description", "תיאור"],
  price: ["price", "regular_price", "מחיר"],
  salePrice: ["sale_price", "מחיר_מבצע"],
  currency: ["currency", "מטבע"],
  link: ["link", "url", "product_url", "permalink", "קישור"],
  image: ["image_link", "image_url", "image", "images", "תמונה"],
  availability: ["availability", "stock_status", "in_stock", "זמינות", "מלאי"],
  categories: ["product_type", "categories", "category", "google_product_category", "קטגוריה", "קטגוריות"],
  interests: ["interests", "תחומי_עניין"],
  occasions: ["occasions", "אירועים"],
  recipients: ["recipients", "מקבלים"],
  affiliateUrl: ["affiliate_url", "affiliate_link", "tracking_url", "קישור_שותפים"],
  minDays: ["delivery_min_days"],
  maxDays: ["delivery_max_days"],
  lastVerified: ["last_verified_at", "updated_at"],
} as const;

export interface MappedRow {
  /** 1-based data row number (excluding the header) for messages. */
  row: number;
  externalId: string | undefined;
  product: CatalogProductInput | undefined;
  errors: string[];
  warnings: string[];
  /** True when interests were inferred from text rather than given in the feed. */
  autoTagged: boolean;
}

export function mapRow(raw: FeedRow, rowNumber: number, store: StoreConfig, now: Date): MappedRow {
  const get = (field: keyof typeof COLUMNS) => {
    for (const col of COLUMNS[field]) {
      const v = raw[col]?.trim();
      if (v) return v;
    }
    return undefined;
  };
  const errors: string[] = [];
  const warnings: string[] = [];
  const externalId = get("id");
  const name = get("name");
  const description = stripHtml(get("description") ?? "");

  // Price: sale price wins when it's valid and lower.
  const regular = parsePrice(get("price"), get("currency"), store.currency);
  const sale = parsePrice(get("salePrice"), get("currency"), store.currency);
  let price = regular;
  if (sale && regular && sale.currency === regular.currency && sale.amount < regular.amount) price = sale;
  else if (sale && !regular) price = sale;
  if (!price) errors.push(`price: missing or unreadable ("${get("price") ?? ""}")`);

  const link = get("link");
  if (link && !link.startsWith("https://")) errors.push("link: must be an https:// URL");

  let imageUrl = firstUrl(get("image"));
  if (imageUrl && !imageUrl.startsWith("https://")) {
    warnings.push("image: not https — image dropped");
    imageUrl = undefined;
  }
  if (!imageUrl) warnings.push("no image");

  const categoryPath = splitCategoryPath(get("categories"));
  const categories = categoryPath.length > 0 ? categoryPath : ["general"];
  if (categoryPath.length === 0) warnings.push('no category — using "general"');

  // Tags: explicit columns win; otherwise infer conservatively from the text.
  const inferred = inferTags([name, description, ...categoryPath].join(" "));
  const explicitInterests = splitList(get("interests"));
  const interests = explicitInterests ?? inferred.interests;
  const autoTagged = explicitInterests === undefined && interests.length > 0;
  if (interests.length === 0) warnings.push("no interest tags — shown only for 'no specific interest'");
  const occasions = splitList(get("occasions")) ?? inferred.occasions ?? store.defaults.occasions;
  const recipients = splitList(get("recipients")) ?? inferred.recipients ?? store.defaults.recipients;

  const affiliateUrl =
    get("affiliateUrl") ??
    (store.affiliateLinkTemplate && link ? buildAffiliateUrl(store.affiliateLinkTemplate, link) : undefined);

  const lastVerified = parseDate(get("lastVerified"));
  const minDays = parseIntOrUndefined(get("minDays")) ?? store.defaults.deliveryMinDays;
  const maxDays = parseIntOrUndefined(get("maxDays")) ?? store.defaults.deliveryMaxDays;
  const hasShipping = store.defaults.shipsTo.length > 0 || minDays !== undefined || maxDays !== undefined;

  const candidate = {
    externalId,
    name,
    description,
    price,
    imageUrl,
    productUrl: link,
    affiliateUrl,
    availability: parseAvailability(get("availability"), warnings),
    shipping: hasShipping ? { shipsTo: store.defaults.shipsTo, minDays, maxDays } : undefined,
    categories,
    interests,
    occasions,
    recipients,
    lastVerifiedAt: lastVerified && lastVerified <= now ? lastVerified : now,
    dataSource: store.dataSource,
    isSample: store.isSample,
  };

  const parsed = CatalogProductSchema.safeParse(candidate);
  if (!parsed.success && errors.length === 0) {
    for (const issue of parsed.error.issues) errors.push(`${issue.path.join(".") || "row"}: ${issue.message}`);
  }
  return {
    row: rowNumber,
    externalId,
    product: errors.length === 0 && parsed.success ? (candidate as CatalogProductInput) : undefined,
    errors,
    warnings,
    autoTagged,
  };
}

const CURRENCY_MARKERS: [RegExp, Currency][] = [
  [/₪|\bILS\b|\bNIS\b|ש"ח|ש״ח|שקל/i, "ILS"],
  [/\$|\bUSD\b/i, "USD"],
  [/€|\bEUR\b/i, "EUR"],
  [/£|\bGBP\b/i, "GBP"],
];

/** "149.90 ILS", "₪1,299", "149,90", "99" → { amount, currency }. */
export function parsePrice(
  value: string | undefined,
  currencyColumn: string | undefined,
  fallback: Currency,
): { amount: number; currency: Currency } | undefined {
  if (!value) return undefined;
  // A minus sign means a negative price or a range ("10-20") — neither is a usable price.
  if (/-\s*\d|\d\s*-/.test(value)) return undefined;
  const marker = CURRENCY_MARKERS.find(([re]) => re.test(value))?.[1];
  const columnCurrency = CURRENCY_MARKERS.find(([re]) => re.test(currencyColumn ?? ""))?.[1];
  const numeric = value.replace(/[^\d.,]/g, "");
  let normalized: string;
  if (/^\d+,\d{1,2}$/.test(numeric)) normalized = numeric.replace(",", "."); // decimal comma
  else normalized = numeric.replace(/,/g, ""); // thousands separators
  const amount = Number(normalized);
  if (!normalized || !Number.isFinite(amount) || amount <= 0) return undefined;
  return { amount: Math.round(amount * 100) / 100, currency: marker ?? columnCurrency ?? fallback };
}

function parseAvailability(value: string | undefined, warnings: string[]): Availability {
  if (!value) {
    warnings.push("availability unknown");
    return "unknown";
  }
  const v = value.toLowerCase().replace(/[\s_-]+/g, "");
  if (["instock", "available", "במלאי", "זמין", "1", "true", "yes", "כן"].includes(v)) return "in_stock";
  if (["outofstock", "soldout", "אזל", "אזלמהמלאי", "0", "false", "no", "לא"].includes(v)) return "out_of_stock";
  warnings.push(`availability "${value}" treated as unknown`);
  return "unknown";
}

/** "Home > Kitchen > Mugs" → ["mugs", "kitchen", "home"] (most specific first = primary category). */
export function splitCategoryPath(value: string | undefined): string[] {
  if (!value) return [];
  const parts = value
    .split(/\s*(?:>|\||\/)\s*/)
    .map((p) => normalizeTag(p))
    .filter((p) => p.length > 0 && p.length <= 60 && !/^\d+$/.test(p));
  return [...new Set(parts.reverse())].slice(0, 3);
}

/** "coffee|cooking" or "coffee, cooking" → ["coffee", "cooking"]; undefined when the column is absent. */
function splitList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const items = value
    .split(/[|,]/)
    .map((v) => normalizeTag(v))
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function firstUrl(value: string | undefined): string | undefined {
  return value?.split(/[\s,|]+/).find((v) => /^https?:\/\//.test(v));
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseIntOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}
