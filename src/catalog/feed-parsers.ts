import { parse as parseCsv } from "csv-parse/sync";
import { XMLParser } from "fast-xml-parser";

/** A feed row with normalized column names (lowercase, no "g:" prefix, spaces → underscores). */
export type FeedRow = Record<string, string>;

export type FeedFormat = "csv" | "google-xml";

/** Picks the parser from the file name, falling back to sniffing the content. */
export function detectFormat(fileName: string, content: string): FeedFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xml") || lower.endsWith(".rss")) return "google-xml";
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) return "csv";
  return content.trimStart().startsWith("<") ? "google-xml" : "csv";
}

export function parseFeed(fileName: string, content: string): FeedRow[] {
  return detectFormat(fileName, content) === "google-xml" ? parseGoogleXml(content) : parseDelimited(content);
}

export function normalizeColumn(name: string): string {
  return name
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/^g:/, "")
    .replace(/[\s-]+/g, "_");
}

/**
 * CSV/TSV as exported by Excel, Google Sheets, Shopify, WooCommerce or Merchant Center.
 * The delimiter (comma, semicolon or tab) is detected from the header line.
 */
export function parseDelimited(content: string): FeedRow[] {
  const text = content.replace(/^\uFEFF/, "");
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = mostFrequent(header, [",", ";", "\t"]);
  const records = parseCsv(text, {
    delimiter,
    columns: (names: string[]) => names.map(normalizeColumn),
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
  }) as Record<string, string | undefined>[];
  return records.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? ""])));
}

function mostFrequent(line: string, candidates: string[]): string {
  let best = candidates[0]!;
  let bestCount = -1;
  for (const c of candidates) {
    const count = line.split(c).length - 1;
    if (count > bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
}

/** Google Merchant Center RSS 2.0 feed: <rss><channel><item><g:id>…</g:id>…</item></channel></rss>. */
export function parseGoogleXml(content: string): FeedRow[] {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false, // keep "0012" as text, not a number
    trimValues: true,
    processEntities: true,
    isArray: (name) => name === "item" || name === "entry",
  });
  const doc = parser.parse(content) as Record<string, any>;
  const items: unknown[] = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? [];
  return items.map((item) => {
    const row: FeedRow = {};
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      // Repeated tags (e.g. several additional_image_link) → keep the first; nested (shipping) → skip.
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === "string" || typeof first === "number") row[normalizeColumn(key)] = String(first);
    }
    return row;
  });
}
