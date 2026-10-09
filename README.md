# GiftBot

AI gift recommendations over WhatsApp. Product context and decisions: [docs/GiftBot_Context.md](docs/GiftBot_Context.md).

## Status

- Stage 1 ✅ Minimal infrastructure (TypeScript, tests, health endpoint).
- Stage 2 ✅ Domain model + recommendation engine, tested against clearly-marked sample data.

No external services (WhatsApp, Supabase, AI model, affiliate programs) are connected yet.

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

## Secrets

Real keys go only in `.env` (ignored by git). Never commit secrets; `.env.example` lists variable names only.
