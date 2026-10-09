# GiftBot

AI gift recommendations over WhatsApp. Product context and decisions: [docs/GiftBot_Context.md](docs/GiftBot_Context.md).

## Status

Stage 1 — minimal infrastructure only. No external services (WhatsApp, Supabase, AI model) are connected yet.

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

## Project layout

```
src/
  app.ts       HTTP routes (currently: GET /health)
  config.ts    Environment variable loading + validation
  server.ts    Entry point
tests/         Automated tests
docs/          Product context
```

## Secrets

Real keys go only in `.env` (ignored by git). Never commit secrets; `.env.example` lists variable names only.
