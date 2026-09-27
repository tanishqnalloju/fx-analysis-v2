# FX Analysis v2

Staging redesign of the INR real-strength research desk.

- **Worker:** `fx-analysis-v2` (NOT `fx-analysis`)
- **Host:** https://v2.fx-analysis.tanishqnalloju.com
- **KV:** same `DATA` namespace as v1 — **read only** on this Worker
- **No cron / no `/api/refresh`** — refresh remains on v1 (`fx-analysis`)

Do not confuse with production v1: https://fx-analysis.tanishqnalloju.com

## Stack

Vite + React + TypeScript + React Router. Themes: Graphite | Slate | Warm | Nord × Dark | Light (default Graphite Dark). Tokens from design SoT Pass 3.

## Scripts

```bash
npm install
npm run build
node scripts/verify-wrangler-name.mjs   # must print fx-analysis-v2
npx wrangler deploy                    # from this directory only
```

## Safety

- Never deploy Worker named `fx-analysis` or `inr-real` from this repo.
- Never modify `/workspace/inr-real`.
- Honest empties `—`; no invented prices / REER / Δ%; no buy/sell language.
