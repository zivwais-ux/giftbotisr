# GiftBot

AI gift recommendations over WhatsApp. Product context and decisions: [docs/GiftBot_Context.md](docs/GiftBot_Context.md).

## Status

- Stage 1 ✅ Minimal infrastructure (TypeScript, tests, health endpoint).
- Stage 2 ✅ Domain model + recommendation engine, tested against clearly-marked sample data.
- Stage 3 ✅ Database schema (Supabase-compatible migrations) + repositories; engine runs against the database.

No external services (WhatsApp, hosted Supabase, AI model, affiliate programs) are connected yet.

## Requirements

- Node.js 22+

## Getting started

```bash
npm install
cp .env.example .env   # optional; defaults work for local development
npm run dev            # starts the server with auto-reload
```

Check it works: open http://localhost:3000/health — expected response: `{"status":"ok","service":"giftbot"}`.

## Scripts

| Command             | What it does                          |
| ------------------- | ------------------------------------- |
| `npm run dev`       | Run the server locally with reload    |
| `npm test`          | Run the test suite (Vitest)           |
| `npm run typecheck` | Type-check all code                   |
| `npm run build`     | Compile to `dist/`                    |
| `npm start`         | Run the compiled server               |
| `npm run demo`      | Run the engine on the sample catalog  |
| `npm run db:migrate` | Apply pending migrations to `DATABASE_URL` |
| `npm run db:seed-sample` | Load the ⚠️ sample catalog (refused in production) |

## Project layout

```
src/
  app.ts                  HTTP routes (currently: GET /health)
  config.ts               Environment variable loading + validation
  server.ts               Entry point
  domain/types.ts         Product & gift-request schemas (zod) — the single source of truth
  domain/money.ts         Currency conversion (rates are always supplied, never invented)
  recommendation/         The recommendation engine (pure functions, no I/O)
    filters.ts            Hard filters, each with a reason code
    scoring.ts            Weighted relevance score
    engine.ts             recommend(): filter → score → threshold → diversity
    context.ts            Engine options, defaults and validation
  data/sample-products.ts ⚠️ Fictional sample catalog for dev/tests only
  data/seed-sample.ts     Loads the sample catalog into the database
  db/database.ts          Minimal DB interface + node-postgres implementation
  db/migrate.ts           Applies supabase/migrations/*.sql in order, once each
  db/catalog-repository.ts        Stores & products: idempotent import, eligible-catalog loading
  db/recommendation-repository.ts Saves each run + snapshot of what was shown
  services/recommendation-service.ts  load catalog → recommend → save
supabase/migrations/      SQL schema (Supabase CLI naming)
scripts/demo.ts           Prints recommendations for a few sample scenarios
tests/                    Automated tests
docs/                     Product context
```

## Recommendation engine

`recommend({ products, request, exchangeRates, now, options })` runs four steps:

1. **Hard filters** — a product is excluded if any rule fails; all reasons are recorded in `excluded`:
   sample data (unless allowed), invalid data, out of stock, data older than 90 days,
   unconvertible currency, over budget by more than 10% (or under an explicit minimum),
   occasion/recipient mismatch, matches the "avoid" list, shipping not possible, or can't arrive by the deadline.
2. **Scoring** (0–1) — interests 30%, occasion & recipient 25%, budget 20%, delivery 15%, data quality 10%.
   **Affiliate commission is never an input** (enforced by a test).
3. **Relevance gate** — if the user named interests, at least one must match; scores below 0.6 are dropped.
   Better to return 2 good gifts than pad to 5. Rejected items are listed in `belowThreshold`.
4. **Diversity** — at most 2 per primary category, unless there's nothing else relevant.

Each recommendation carries `warnings` (e.g. `price_converted`, `availability_unknown`,
`price_not_recently_verified`, `sample_data`) so the bot can tell users honestly what isn't verified.

All thresholds and weights are configurable via `options` and are starting points to tune with real users.

## Database

Schema: `supabase/migrations/`. Tables: `stores`, `products`, `product_attributes`, `users`,
`conversations`, `recommendation_sessions`, `recommendation_items`, `analytics_events`.

Key rules enforced by the database itself:
- A store can be `approved` only after a recorded terms review confirming links may be sent over messaging apps.
  Only approved stores feed recommendations; product images are used only if the store allowed them.
- Sample data (`is_sample`) is never loaded unless explicitly requested.
- Every recommendation shown is stored with the exact price/score/warnings shown, plus the engine version and options.
- Row Level Security is on for every table with no policies: Supabase's public API keys can read nothing.
  Only the backend (direct Postgres connection) accesses data.

Local usage: set `DATABASE_URL` in `.env`, then `npm run db:migrate` and optionally `npm run db:seed-sample`.

### Database tests

`npm test` runs database tests on [PGlite](https://pglite.dev) (real Postgres in-process — no server needed).
To run them against a real Postgres instead, set `TEST_DATABASE_URL` to a database whose name contains
`test` — **it will be wiped**.

## Secrets

Real keys go only in `.env` (ignored by git). Never commit secrets; `.env.example` lists variable names only.
