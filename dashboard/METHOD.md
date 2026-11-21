# Token Radar — method

## What this radar is

One frozen DefiLlama protocols snapshot (758 protocols, as of 2026-11-14,
floor $50,000,000) in, one ranked board out. The board ranks every protocol
in the snapshot that records **no token**, is not a wrapped or staked
product, and is not in an excluded category (Bridge, Canonical Bridge,
Liquid Staking, Liquid Restaking, Restaked BTC, CEX): the 40-protocol
watchlist plus every other protocol that passes the same rule — 198 rows in
this snapshot. Cross Chain Bridge protocols are included — bridging between
chains is a service the board ranks — while Bridge and Canonical Bridge
are excluded. Protocols whose token
already trades sit apart, ranked by their own market cap, and are the peers
the model is calibrated on.

"Records no token" means the snapshot carries no CoinGecko id, no symbol
and no market cap for that protocol. It is a statement about the record,
not about what exists off the record: some rows are stablecoins or
products whose token exists off the record — USDD, for example, is a
stablecoin in the CDP category. The board follows the snapshot's record
only, and the farm plan for such a row acts on the product as the snapshot
describes it.

## The value model (radar-2)

```
implied = round(TVL x multiple(category) x growth x maturity x odds)
```

- **multiple(category)** — the median market-cap / TVL of the peers in that
  category, shrunk toward the global median with a prior weight of 8
  protocols, used only when the category has at least 3 peers (fewer fall
  back to the global median) and capped at twice the global median. Peer
  ratios are winsorized at their 90th percentile before any median is
  taken.
- **growth** — 1 + clamp(change_7d, -50%, +100%) x 0.25. A week of growth
  moves the value by at most a quarter of its size.
- **maturity** — 0.8 + 0.2 x min(age_days, 1095) / 1095. A protocol with no
  listing date is scored at 365 days.
- **odds** — 0.5 + 0.5 x the blended token-record rate (half by age band,
  half by category): how often comparable protocols record a token at all.

## Calibration, measured on this snapshot

- Peers: 128 protocols with a positive market cap and TVL.
- Global median market-cap / TVL: 0.2138 (10th percentile 0.013, 90th 2.97).
- Winsor cap (90th percentile of peer ratios): 2.97. One peer's ratio is
  400.2x; without winsorizing it would set its whole category's multiple.
- Minimum peers per category median: 3. Categories with fewer peers use
  the global median: Risk Curators (1 peer), Prediction Market (1),
  Chain (1), Collateral Management (1), Onchain Capital Allocator (2),
  and 15 more. Cap: twice the global median, 0.4276 — Canonical Bridge
  and Cross Chain Bridge sit at the cap.
- Category multiples (shrunk medians, after the rules above): Lending
  0.1607, Dexs 0.2883, Yield 0.2020, Liquid Staking 0.1221, RWA 0.2461,
  CDP 0.2015, Basis Trading 0.4194, Privacy 0.4198, Bridge 0.3608,
  Indexes 0.1958, Yield Aggregator 0.1929, CEX 0.1402.
- Token-record odds by age: 0.26 under 180 days, 0.40 at 180–365, 0.54 at
  365–730, 0.55 at 730–1095, 0.79 past 1095 days; overall 0.55.
  By category they run from 0.13 (Risk Curators) to 0.79 (Lending).

## Hold-out validation (64 fit / 64 test, peers sorted by slug)

| Variant | Rank correlation | Median error |
|---|---|---|
| Raw TVL | 0.458 | 464.9% |
| Global median multiple | 0.458 | 92.2% |
| Full model | 0.438 | 92.5% |

The odds tables in this hold-out are rebuilt leave-one-out for each test
peer, so a test peer's own token record never raises its own odds. The v1
hold-out (0.434 / 91.8%) counted the test peers in the odds tables and is
superseded. Calibration buys the absolute scale — a 465% median error
becomes about 92% — and a defensible separation between categories. It
does not beat raw TVL on rank correlation, and the differences among
calibrated variants are inside noise (n = 64), so every adjustment term
stays small and bounded. These numbers are recomputed from the snapshot at
every build and shown on the Method tab; the table above is the measured
result for this snapshot.

Tested and not adopted: log-geometric multiples (0.455 / 92.8%), a fitted
TVL power law — log(mcap/TVL) falls with log(TVL), correlation -0.41,
slope -0.48 — which cuts the hold-out median error to 84.5% but lowers
rank correlation to 0.417 and compresses the board's top, min-peers 4
(0.444 / 91.2%) and 5 (0.437 / 90.0%), shrink 0 (0.450 / 89.8%), growth
weight 0 (0.443 / 92.2%), odds weight 1.0 (0.446 / 92.3%). Nothing beats
TVL-only on rank, so the model is kept for what it provably buys:
calibrated absolute scale, category separation, token odds, and the
live/pre-token split.

## Farm plans

Six steps per protocol, derived from its own record (category, chains, TVL,
age): gas and the funding asset ready on its first chain (USDC, or BTC on
Bitcoin, which has no native USDC), the category's one action,
one qualifying action a week, a hold of 30–60 days, a weekly monitor plus
an honest rewards check, and a withdrawal. Each step names its cost and
its time. Capital follows TVL so the position stays small next to the
protocol's own scale: $50 under $100M, $100 to $1B, $150 to $5B, $250
above. Gas is chain-sensitive and given as a range, never a precise fee:
about $5–$20 an action on Ethereum, about $0.05–$2 elsewhere. The action
varies by category — insurance buys cover and never swaps or votes,
prediction takes market positions, lending borrows and repays, a risk
curator takes a deposit into a curated vault, a CDP deposits its accepted
collateral (USDC where the protocol accepts it, BTC for the Bitcoin-backed
Bima) and holds the stable asset it mints. Step 5 says
plainly that the snapshot records no rewards program for the protocol and
to check the protocol's own docs and announcements. Nothing promises an
airdrop: the snapshot carries no launch date, and no protocol's launch is
guaranteed.

## Limits

The model predicts a traded market cap with a ~92% median error — it ranks
candidates, it does not price them. A protocol can stay token-less forever,
and a token can trade far from any TVL multiple. The snapshot is frozen at
2026-11-14; nothing here is live data or financial advice.
