import { deactivateProduct, upsertProduct, upsertStore } from "../db/catalog-repository.js";
import type { Database } from "../db/database.js";
import type { FeedRow } from "./feed-parsers.js";
import { mapRow, type MappedRow } from "./row-mapper.js";
import { toStoreInput, type StoreConfig } from "./store-config.js";

export interface ImportOptions {
  /** Write to the database. When false (default), only report what would happen. */
  apply?: boolean;
  /** The file is the store's full catalog: deactivate the store's products that aren't in it. */
  sync?: boolean;
  now?: Date;
}

export interface ImportReport {
  store: string;
  storeApproved: boolean;
  applied: boolean;
  totalRows: number;
  valid: number;
  invalid: { row: number; externalId?: string; errors: string[] }[];
  /** Warnings grouped by message, with the number of rows affected. */
  warningCounts: Record<string, number>;
  autoTagged: number;
  withoutInterests: number;
  created: number;
  updated: number;
  /** Products deactivated (applied) or that would be deactivated (dry run) because of --sync. */
  deactivated: number;
}

/**
 * Imports a store's products from parsed feed rows. Each product is upserted by (store, external id),
 * so re-running the same file is safe. Invalid rows are reported and skipped, never half-imported.
 */
export async function importCatalog(
  db: Database,
  store: StoreConfig,
  rows: FeedRow[],
  options: ImportOptions = {},
): Promise<ImportReport> {
  const now = options.now ?? new Date();
  const mapped = rows.map((row, i) => mapRow(row, i + 1, store, now));
  markDuplicates(mapped);

  const valid = mapped.filter((m) => m.product);
  const report: ImportReport = {
    store: store.slug,
    storeApproved: store.terms.approvalStatus === "approved",
    applied: Boolean(options.apply),
    totalRows: rows.length,
    valid: valid.length,
    invalid: mapped
      .filter((m) => !m.product)
      .map((m) => ({ row: m.row, externalId: m.externalId, errors: m.errors })),
    warningCounts: countWarnings(mapped),
    autoTagged: valid.filter((m) => m.autoTagged).length,
    withoutInterests: valid.filter((m) => m.product!.interests?.length === 0).length,
    created: 0,
    updated: 0,
    deactivated: 0,
  };

  const existing = await existingProducts(db, store.slug);
  const incoming = new Set(valid.map((m) => m.externalId!));
  const missing = [...existing.entries()].filter(([externalId, p]) => p.active && !incoming.has(externalId));
  for (const m of valid) {
    if (existing.has(m.externalId!)) report.updated++;
    else report.created++;
  }
  if (options.sync) report.deactivated = missing.length;
  if (!options.apply) return report;

  const storeId = await upsertStore(db, toStoreInput(store));
  for (const m of valid) await upsertProduct(db, storeId, m.product!);
  if (options.sync) for (const [, p] of missing) await deactivateProduct(db, p.id);
  return report;
}

/** A repeated id in the same file is almost always a feed error; keep the first, reject the rest. */
function markDuplicates(mapped: MappedRow[]): void {
  const seen = new Map<string, number>();
  for (const m of mapped) {
    if (!m.product || !m.externalId) continue;
    const first = seen.get(m.externalId);
    if (first !== undefined) {
      m.errors.push(`duplicate id "${m.externalId}" (first seen in row ${first})`);
      m.product = undefined;
    } else {
      seen.set(m.externalId, m.row);
    }
  }
}

function countWarnings(mapped: MappedRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of mapped) {
    if (!m.product) continue;
    for (const w of m.warnings) counts[w] = (counts[w] ?? 0) + 1;
  }
  return counts;
}

async function existingProducts(db: Database, storeSlug: string): Promise<Map<string, { id: string; active: boolean }>> {
  const { rows } = await db.query<{ external_id: string; id: string; is_active: boolean }>(
    `select p.external_id, p.id, p.is_active from public.products p
     join public.stores s on s.id = p.store_id
     where s.slug = $1`,
    [storeSlug],
  );
  return new Map(rows.map((r) => [r.external_id, { id: r.id, active: r.is_active }]));
}

/** Human-readable summary for the command line. */
export function formatReport(r: ImportReport): string {
  const lines = [
    `Store: ${r.store}${r.storeApproved ? "" : "  ⚠️ NOT APPROVED — products will be stored but never shown to users"}`,
    r.applied ? "Mode: APPLIED to the database" : "Mode: DRY RUN (nothing written — add --apply to import)",
    `Rows: ${r.totalRows} | valid: ${r.valid} | invalid: ${r.invalid.length}`,
    `New: ${r.created} | updated: ${r.updated}${r.deactivated ? ` | deactivated (--sync): ${r.deactivated}` : ""}`,
    `Interest tags: ${r.autoTagged} auto-tagged | ${r.withoutInterests} without any interest tag`,
  ];
  const warnings = Object.entries(r.warningCounts).sort((a, b) => b[1] - a[1]);
  if (warnings.length) {
    lines.push("Warnings:");
    for (const [w, n] of warnings) lines.push(`  - ${w}: ${n} rows`);
  }
  if (r.invalid.length) {
    lines.push("Invalid rows (skipped):");
    for (const i of r.invalid.slice(0, 20)) {
      lines.push(`  - row ${i.row}${i.externalId ? ` (id ${i.externalId})` : ""}: ${i.errors.join("; ")}`);
    }
    if (r.invalid.length > 20) lines.push(`  ... and ${r.invalid.length - 20} more`);
  }
  return lines.join("\n");
}
