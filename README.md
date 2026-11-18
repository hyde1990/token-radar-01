# Token Radar

[![make.fun — token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![make.fun — rank](https://make.fun/badge/token-radar-01/hyde1990/token-radar-01/rank.svg)](https://make.fun/c/token-radar-01)
[![make.fun — reward](https://make.fun/badge/token-radar-01/hyde1990/token-radar-01/reward.svg)](https://make.fun/c/token-radar-01)

A token launch radar for the make.fun `token-radar-01` bounty: 200 pre-token
protocols ranked by an implied value, each with a concrete six-step farm plan, in a
static dashboard a reader can sort, filter and open protocol by protocol.

## What it does

`main.ts` (Node 22, standard library only, no network) reads the sealed snapshot
at `/input/snapshot.json`, scores every pre-token protocol with the model in
`lib/model.ts`, and writes:

- `/output/board.json` — 200 ranked rows (40 watchlist + 160 early)
- `/output/data.js` — the same board for the dashboard
- `/output/dashboard/` — the static page (index.html, app.css, app.js)
- `/output/screenshots/` — the board, a detail view and a filtered view
- `/output/dossier.json` — built with the vendored `vendor/makefun-board.ts`

Run it locally:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

## The model ("tide-1")

Implied value is one deterministic function of the snapshot's own figures, the
same for every protocol — no name is ever special-cased:

```
implied = round( tvl_usd x 0.20
               x (1 + clamp(change_7d, -50, 100) / 100 x 0.70)
               x (0.55 + min(age_days, 1460) / 1460 x 0.45)
               x (1 + 0.04 x min(chains, 5)) )
```

- **TVL** — the size of the record so far.
- **Seven-day growth** — its direction, clamped so one wild week cannot decide a rank.
- **Tenure** — how long the protocol has run with no token (days since `listed_at`,
  unknown age counts as 180 days). A long wait with a large TVL is the launch this
  radar exists to catch.
- **Breadth** — how many chains the record spans, up to five.

Whole-dollar rounding can tie two protocols, so after sorting, a row that ties or
beats the row above it is written one dollar lower: the board is strictly
decreasing from rank 1 to rank 200, and the ranking never rests on a tie.

The early radar is the 160 highest-implied pre-token protocols below the $50M
watchlist floor, by value rather than by size, so a fast-growing small protocol can
outrank a large still one. Live-token protocols are set aside with their market
caps shown — the market's own number, never a model number.

## The dashboard

A dark, static page with no network and no framework:

- a sortable board (rank, protocol, TVL, 7-day growth, age, implied value)
- search, category filter, chain filter and a watchlist-only switch
- a detail panel for every protocol: the model's inputs and multipliers, the
  recomputed implied value, and its six-step farm plan
- a separate Live token tab, so protocols whose token already trades are never
  mixed into the ranking

Every farm step names what to do, what it costs and how long it takes, derived
from the protocol's own category, chains, TVL and age.

## Files

- `main.ts` — the entrypoint
- `lib/model.ts` — the value model, the board builder and the farm plans
- `dashboard/` — `index.html`, `app.css`, `app.js`
- `screenshots/` — `1-board.png`, `2-detail.png`, `3-filtered.png`
- `vendor/makefun-board.ts` — make.fun's vendored dossier library (not our code)
- `validate.mjs` — the local gate checker (the seven rows of the scorer's gate)
- `.makefun/owner.json` — the claim file for this entry's payout wallet
