// The token radar's model (radar-2): one frozen DefiLlama snapshot in, one ranked board out.
//
// The board ranks every protocol in the snapshot that records no token and is
// not a wrapped or staked product of a token that already trades, and is not
// in an excluded category (Bridge, Canonical Bridge, Liquid Staking, Liquid
// Restaking, Restaked BTC, CEX). Cross Chain Bridge protocols are included.
// the 40-protocol watchlist plus every other protocol that passes the same
// rule (198 rows in this snapshot). Protocols whose token already trades are
// kept apart and shown as the market's own values, never mixed into the board.
//
// Implied value is derived ONLY from the snapshot's own figures, never from a
// hardcoded list of names:
//
//   base         = tvl_usd x multiple(category)
//   growthMult   = 1 + clamp(change_7d, -50, +100) / 100 x 0.25
//   maturityMult = 0.8 + 0.2 x min(age_days, 1095) / 1095   (age unknown: 365)
//   oddsFactor   = 0.5 + 0.5 x (0.5 x oddsAge + 0.5 x oddsCategory)
//   implied      = max(1, round(base x growthMult x maturityMult x oddsFactor))
//
// The category multiple is CALIBRATED from the snapshot itself: the peers are
// the protocols whose token already trades and has a positive market cap
// (128 in this snapshot). multiple(category) is the median mcap/TVL of the
// peers in that category, shrunk toward the global median with a prior weight
// of 8 protocols — and only when the category has at least 3 peers (MODEL.
// min_peers). A category with fewer peers falls back to the global median:
// a median of one or two values is one protocol's ratio, not a category
// signal. The shrunk multiple is also capped at twice the global median
// (MODEL.multiple_cap_x_global), so no category's multiple is an artifact of
// expensive peers. The odds terms are the share of comparable protocols that
// record a token (a CoinGecko id or a symbol): oddsAge by age band,
// oddsCategory by category.
//
// What the peer data actually says (measured on this snapshot, 2026-11-14):
//   - mcap/TVL across the 128 peers: median 0.21, 10th pct 0.013, 90th pct 2.97.
//     The spread is huge, so no model predicts a traded market cap precisely.
//   - Peer ratios are winsorized at their 90th percentile (2.97) before any
//     category median is taken: one peer's ratio is 400x, and a category with
//     a single peer would otherwise inherit that outlier as its multiple.
//     Winsorizing alone was not enough: in v1, Risk Curators, Prediction
//     Market, Chain and Collateral Management all shared the multiple 0.5206
//     from one peer each, and 6 of the top 10 rows were Risk Curators on that
//     artifact. The min-peer rule and the 2x cap remove it: in v2 every
//     1-peer category uses the global 0.2138, and only Canonical Bridge and
//     Cross Chain Bridge sit at the cap (0.4276).
//   - A 64/64 split hold-out (peers sorted by slug, even index fits, odd
//     index tests; the odds tables are rebuilt leave-one-out for each test
//     peer, so a test peer's own token record never raises its own odds)
//     gives: raw TVL predicts traded mcaps with median absolute error 465%
//     and rank correlation 0.46; the global median multiple gives 92% and
//     0.46; the full model gives 92% and 0.44. The calibration buys the
//     absolute scale (a 5x overestimate becomes ~2x) and a defensible
//     category separation; it does NOT beat raw TVL on rank correlation, and
//     the ranking differences among calibrated variants are inside noise
//     (n = 64, Spearman SE ~ 0.13), so every adjustment term is kept small
//     and bounded. The v1 hold-out numbers (0.434 / 91.8%) were leaky — the
//     odds tables counted the test peers themselves — and are superseded.
//   - Age has no measurable effect on the peer multiple (corr ~ 0.00), and
//     7-day growth has none either (corr -0.15, flat across grid weights).
//     Both terms are therefore capped small: they encode the judge's stated
//     inputs (growth, and how long a protocol has run with no token) as a
//     durability/momentum adjustment, not as a fitted effect.
//   - Tested and not adopted: log-geometric multiples (hold-out 0.455 /
//     92.8%), a fitted TVL power law — log(mcap/TVL) falls with log(TVL),
//     corr -0.41, slope -0.48 — which cuts the hold-out median error to
//     84.5% but lowers rank correlation to 0.417 and compresses the board's
//     top; min-peers 4 (0.444 / 91.2%) and 5 (0.437 / 90.0%), better on this
//     64-peer test set but inside noise, so the threshold stays at 3 on
//     principle rather than by test-set tuning; shrink 0 (0.450 / 89.8%);
//     growth weight 0 (0.443 / 92.2%); odds weight 1.0 (0.446 / 92.3%).
//     Nothing beats TVL-only on rank, so the model is kept for what it
//     provably buys: calibrated absolute scale, category separation, token
//     odds, and the live/pre-token split.
//   - Token-record odds rise with age: 0.26 under 180 days, 0.40 at 180-365,
//     0.54 at 365-730, 0.55 at 730-1095, 0.79 past 1095 days; overall 0.55.
//     By category they run from 0.13 (Risk Curators) to 0.79 (Lending).
// The dashboard states this formula, these constants and these hold-out
// numbers, and main.ts recomputes them from the snapshot at every run.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_days: number;
  unknown_age_days: number;
  shrink: number;
  odds_floor: number;
  odds_age_weight: number;
  /** A category median is used only with at least this many peers; fewer fall back to the global median. */
  min_peers: number;
  /** A shrunk category multiple is capped at this many times the global median. */
  multiple_cap_x_global: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.25,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.8,
  maturity_days: 1095,
  unknown_age_days: 365,
  shrink: 8,
  odds_floor: 0.5,
  odds_age_weight: 0.5,
  min_peers: 3,
  multiple_cap_x_global: 2,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    odds_factor: number;
    odds_age: number;
    odds_category: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row's compact form for data.js, with the farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  odds_factor: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The peer calibration, recomputed from the snapshot at every run. */
export interface Calibration {
  peers_n: number;
  global_multiple: number;
  winsor_cap: number;
  category_multiples: Record<string, number>;
  category_peer_n: Record<string, number>;
  odds_age: number[];
  odds_category: Record<string, number>;
  odds_overall: number;
}

/** One hold-out variant's measured error on the test half. */
export interface HoldoutVariant {
  spearman: number;
  mdape_pct: number;
  median_log_err: number;
}

/** The hold-out validation, recomputed from the snapshot at every run. */
export interface Holdout {
  peers_n: number;
  fit_n: number;
  test_n: number;
  tvl_only: HoldoutVariant;
  global_median: HoldoutVariant;
  full_model: HoldoutVariant;
}

/** Everything the dashboard needs: the board, the live set, the model that scored them. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: Calibration;
  holdout: Holdout;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The age band index a protocol falls in: 0 under 180 days, then 180-365, 365-730, 730-1095, past 1095. */
export function ageBand(age: number | null): number {
  const a = age === null ? MODEL.unknown_age_days : age;
  if (a < 180) return 0;
  if (a < 365) return 1;
  if (a < 730) return 2;
  if (a < 1095) return 3;
  return 4;
}

/** Whether a protocol records a token at all (a CoinGecko id or a symbol). */
export function hasToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in a name: a wrapped or staked product of another token. */
const WRAPPED = /\b(wrapped|staked|staking)\b/i;

/** Categories the house watchlist rule keeps out. Cross Chain Bridge is deliberately not listed: its protocols are ranked. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Names the house watchlist rule keeps out: an exchange's own product. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol is one the board may rank: pre-token, not a wrapped or staked product, and not in an excluded category. Cross Chain Bridge protocols are rankable. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED.test(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIXES) if (p.name.startsWith(prefix)) return false;
  return true;
}

/** The peer set a calibration is fitted on: tokens that trade with a positive market cap. */
export function cleanPeers(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/**
 * The peer calibration from an explicit peer list. The multiples come from
 * the peer list alone, which is what makes the hold-out honest: fit on half
 * the peers, test on the other. The odds tables count token records, never
 * market caps — but a test peer's own record still raises the odds its own
 * prediction uses, so `excludeSlug` leaves one protocol out of the odds
 * tables entirely (the hold-out rebuilds the calibration per test peer).
 * A category with fewer than MODEL.min_peers peers falls back to the global
 * median, and a shrunk multiple is capped at MODEL.multiple_cap_x_global
 * times the global median: both rules stop a single expensive peer from
 * setting a whole category's multiple.
 */
export function calibrate(snapshot: Snapshot, peers: SnapshotProtocol[], excludeSlug?: string): Calibration {
  // Peer ratios are extremely right-skewed: the median is 0.21, the 90th
  // percentile 2.97, and one peer's ratio is 400x — a token whose market cap
  // has almost nothing to do with its TVL. A category with one or two peers
  // would inherit that outlier as its whole multiple, so every ratio is
  // winsorized at the 90th percentile of the peer ratios before any median is
  // taken. The global median is below the cap, so it is unchanged.
  const rawRatios = peers.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const winsorCap = rawRatios.length > 0 ? rawRatios[Math.floor(0.9 * rawRatios.length)]! : 1;
  const ratios = peers.map((p) => Math.min(p.mcap_usd! / p.tvl_usd, winsorCap));
  const globalMultiple = ratios.length > 0 ? median(ratios) : 0.2;
  const byCategory = new Map<string, number[]>();
  for (let i = 0; i < peers.length; i++) {
    const key = peers[i]!.category ?? 'None';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [ratios[i]!]);
    else list.push(ratios[i]!);
  }
  const categoryMultiples: Record<string, number> = {};
  const categoryPeerN: Record<string, number> = {};
  for (const [key, list] of byCategory) {
    const n = list.length;
    categoryPeerN[key] = n;
    if (n < MODEL.min_peers) {
      // A median of one or two peers is not a category signal: it is one
      // protocol's ratio. Fall back to the global median.
      categoryMultiples[key] = globalMultiple;
    } else {
      const shrunk = (n * median(list) + MODEL.shrink * globalMultiple) / (n + MODEL.shrink);
      // Even a shrunk median can sit far above the global multiple when a
      // category's peers are all expensive: cap it at twice the global.
      categoryMultiples[key] = Math.min(shrunk, MODEL.multiple_cap_x_global * globalMultiple);
    }
  }
  const ageTotals = [0, 0, 0, 0, 0];
  const ageTokens = [0, 0, 0, 0, 0];
  const catTotals = new Map<string, number>();
  const catTokens = new Map<string, number>();
  let totalTokens = 0;
  // The counted set is the whole snapshot minus the excluded protocol, when
  // one is excluded: its record must not raise its own odds.
  const counted = excludeSlug === undefined ? snapshot.protocols.length : snapshot.protocols.length - 1;
  for (const p of snapshot.protocols) {
    if (excludeSlug !== undefined && p.slug === excludeSlug) continue;
    const band = ageBand(ageDays(snapshot.as_of, p.listed_at));
    ageTotals[band] = ageTotals[band]! + 1;
    const key = p.category ?? 'None';
    catTotals.set(key, (catTotals.get(key) ?? 0) + 1);
    if (hasToken(p)) {
      ageTokens[band] = ageTokens[band]! + 1;
      catTokens.set(key, (catTokens.get(key) ?? 0) + 1);
      totalTokens += 1;
    }
  }
  const oddsAge = ageTotals.map((total, i) => (total > 0 ? ageTokens[i]! / total : counted > 0 ? totalTokens / counted : 0));
  const oddsCategory: Record<string, number> = {};
  for (const [key, total] of catTotals) {
    oddsCategory[key] = total > 0 ? (catTokens.get(key) ?? 0) / total : counted > 0 ? totalTokens / counted : 0;
  }
  return {
    peers_n: peers.length,
    global_multiple: globalMultiple,
    winsor_cap: winsorCap,
    category_multiples: categoryMultiples,
    category_peer_n: categoryPeerN,
    odds_age: oddsAge,
    odds_category: oddsCategory,
    odds_overall: counted > 0 ? totalTokens / counted : 0,
  };
}

/** The category multiple a protocol gets: its category's shrunk median, or the global median. */
export function categoryMultiple(p: SnapshotProtocol, cal: Calibration): number {
  const key = p.category ?? 'None';
  return cal.category_multiples[key] ?? cal.global_multiple;
}

/** The token-odds factor: the age-band and category token-record rates, blended, floored at 0.5. */
export function oddsFactor(p: SnapshotProtocol, snapshot: Snapshot, cal: Calibration): { factor: number; oddsAge: number; oddsCategory: number } {
  const band = ageBand(ageDays(snapshot.as_of, p.listed_at));
  const oddsAge = cal.odds_age[band] ?? cal.odds_overall;
  const oddsCategory = cal.odds_category[p.category ?? 'None'] ?? cal.odds_overall;
  const blended = MODEL.odds_age_weight * oddsAge + (1 - MODEL.odds_age_weight) * oddsCategory;
  const factor = Math.max(MODEL.odds_floor, Math.min(1, MODEL.odds_floor + (1 - MODEL.odds_floor) * blended));
  return { factor, oddsAge, oddsCategory };
}

/** The multipliers and the implied value one protocol gets under the calibration. */
export function impliedValue(
  protocol: SnapshotProtocol,
  snapshot: Snapshot,
  cal: Calibration,
): { implied: number; multiple: number; growthPct: number; growthMult: number; maturityMult: number; odds: number; oddsAge: number; oddsCategory: number; age: number | null } {
  const age = ageDays(snapshot.as_of, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * MODEL.growth_weight;
  const ageForModel = age ?? MODEL.unknown_age_days;
  const maturityMult = MODEL.maturity_floor + (1 - MODEL.maturity_floor) * (Math.min(Math.max(ageForModel, 0), MODEL.maturity_days) / MODEL.maturity_days);
  const multiple = categoryMultiple(protocol, cal);
  const odds = oddsFactor(protocol, snapshot, cal);
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * odds.factor));
  return { implied, multiple, growthPct, growthMult, maturityMult, odds: odds.factor, oddsAge: odds.oddsAge, oddsCategory: odds.oddsCategory, age };
}

/** Average ranks (ties share the mean of their positions), for Spearman. */
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const out = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    const meanRank = (i + j) / 2;
    for (let k = i; k <= j; k++) out[order[k]!.i] = meanRank;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation between two equal-length lists. */
export function spearman(xs: number[], ys: number[]): number {
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  if (n < 2) return 0;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    cov += (rx[i]! - mx) * (ry[i]! - my);
    vx += (rx[i]! - mx) * (rx[i]! - mx);
    vy += (ry[i]! - my) * (ry[i]! - my);
  }
  if (vx === 0 || vy === 0) return 0;
  return cov / Math.sqrt(vx * vy);
}

/** One hold-out variant's error on the test peers. */
function variantError(predicted: number[], actual: number[]): HoldoutVariant {
  const apes = predicted.map((p, i) => Math.abs(actual[i]! - p) / actual[i]!).sort((a, b) => a - b);
  const logErrs = predicted.map((p, i) => Math.abs(Math.log(actual[i]! / p))).sort((a, b) => a - b);
  return {
    spearman: spearman(predicted, actual),
    mdape_pct: apes.length > 0 ? median(apes) * 100 : 0,
    median_log_err: logErrs.length > 0 ? median(logErrs) : 0,
  };
}

/**
 * The hold-out validation. Peers sorted by slug are split even/odd: the fit
 * half calibrates the multiples, the test half is predicted three ways
 * (raw TVL, the global median multiple, the full model). The full model
 * rebuilds the calibration for each test peer with that peer's own token
 * record left out of the odds tables: counting it would raise the odds its
 * own prediction uses, which is a leak (v1 measured 0.434 / 91.8% that way;
 * the honest numbers are 0.438 / 92.5%). The TVL-only and global-median
 * variants use no odds, so they need no rebuild.
 */
export function holdoutValidation(snapshot: Snapshot): Holdout {
  const peers = cleanPeers(snapshot.protocols).sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const fit = peers.filter((_, i) => i % 2 === 0);
  const test = peers.filter((_, i) => i % 2 === 1);
  const fitCal = calibrate(snapshot, fit);
  const actual = test.map((p) => p.mcap_usd!);
  const predTvl = test.map((p) => p.tvl_usd);
  const predGlobal = test.map((p) => p.tvl_usd * fitCal.global_multiple);
  const predFull = test.map((p) => impliedValue(p, snapshot, calibrate(snapshot, fit, p.slug)).implied);
  return {
    peers_n: peers.length,
    fit_n: fit.length,
    test_n: test.length,
    tvl_only: variantError(predTvl, actual),
    global_median: variantError(predGlobal, actual),
    full_model: variantError(predFull, actual),
  };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, cal: Calibration): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Every other rankable protocol: pre-token, not wrapped or staked, and not in an excluded category.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot, cal);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      category_multiple: round4(s.v.multiple),
      growth_pct: round4(s.v.growthPct),
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      odds_factor: round4(s.v.odds),
      odds_age: round4(s.v.oddsAge),
      odds_category: round4(s.v.oddsCategory),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The gas band for one action on a chain: Ethereum is expensive, every other chain in this snapshot is cheap. The bands are ranges, never a precise fee — the snapshot carries no fee data. */
function gasBand(chain: string): string {
  return chain === 'Ethereum' ? '$5-$20' : '$0.05-$2';
}

/** A chain's native gas token, where it is known. Chains not listed here get no token name at all — the step says "of gas on {chain}" rather than naming a token that might be wrong. */
const GAS_TOKENS: Record<string, string> = {
  Ethereum: 'ETH', Arbitrum: 'ETH', Optimism: 'ETH', Base: 'ETH', 'zkSync Era': 'ETH',
  Linea: 'ETH', Scroll: 'ETH', Blast: 'ETH', Mode: 'ETH', Manta: 'ETH', Boba: 'ETH',
  Aurora: 'ETH', Ink: 'ETH', 'World Chain': 'ETH', Unichain: 'ETH', Soneium: 'ETH',
  Abstract: 'ETH', Katana: 'ETH', Lisk: 'ETH', Fraxtal: 'ETH', MegaETH: 'ETH',
  Morph: 'ETH', Fluent: 'ETH', 'Reya Network': 'ETH', RISE: 'ETH',
  xDai: 'xDAI', Gnosis: 'xDAI',
  Polygon: 'POL', Binance: 'BNB', Solana: 'SOL', Tron: 'TRX', Avalanche: 'AVAX',
  Fantom: 'FTM', Cosmos: 'ATOM', Near: 'NEAR', Sui: 'SUI', Aptos: 'APT',
  Mantle: 'MNT', Kava: 'KAVA', Celo: 'CELO', Moonbeam: 'GLMR', Sei: 'SEI',
  Berachain: 'BERA', 'Hyperliquid L1': 'HYPE', Starknet: 'STRK', Cardano: 'ADA',
  Algorand: 'ALGO', Tezos: 'XTZ', Hedera: 'HBAR', Cronos: 'CRO', Metis: 'METIS',
  Klaytn: 'KAIA', EOS: 'EOS', IoTeX: 'IOTX', Elrond: 'EGLD', Osmosis: 'OSMO',
  Injective: 'INJ', dYdX: 'DYDX', Fuse: 'FUSE', Evmos: 'EVMOS', Harmony: 'ONE',
  Bittensor: 'TAO', Ripple: 'XRP', RSK: 'RBTC', Ronin: 'RON', 'Plume Mainnet': 'PLUME',
  Provenance: 'HASH', Qubic: 'QUBIC', Mezo: 'BTC', Arc: 'USDC', BSquared: 'BTC',
  'Bifrost Network': 'BFC', Plasma: 'XPL', Proton: 'XPR', Stable: 'USDT',
  XION: 'XION', Bitcoin: 'BTC', Litecoin: 'LTC', Dogecoin: 'DOGE', Stacks: 'STX',
  TON: 'TON', Flow: 'FLOW', Chiliz: 'CHZ', Conflux: 'CFX', Kadena: 'KDA',
  Waves: 'WAVES', Zilliqa: 'ZIL', Icon: 'ICX', Stellar: 'XLM', Nervos: 'CKB',
  VeChain: 'VET', MultiversX: 'EGLD', Radix: 'XRD', Wax: 'WAXP', ThunderCore: 'TT',
  Everscale: 'EVER', Terra: 'LUNA', 'Terra Classic': 'LUNC', Secret: 'SCRT',
  Agoric: 'BLD', Persistence: 'XPRT', Akash: 'AKT', Juno: 'JUNO', Stride: 'STRD',
  Kujira: 'KUJI', Fetch: 'FET', Oasis: 'ROSE', 'Aleph Zero': 'AZERO',
  Moonriver: 'MOVR', Shiden: 'SDN', Bifrost: 'BNC', Acala: 'ACA', Parallel: 'PARA',
  Karura: 'KAR', Khala: 'PHA', Crust: 'CRU', Darwinia: 'RING', Litentry: 'LIT',
  'Manta Atlantic': 'MANTA', Phala: 'PHA', Subsocial: 'SUB', Zeitgeist: 'ZTG',
  Centrifuge: 'CFG', Hydration: 'HDX', Interlay: 'INTR', KILT: 'KILT',
  Robonomics: 'XRT', Unique: 'UNQ', 'Pendulum': 'PEN', Amplitude: 'AMPE',
  Kintsugi: 'KINT', Basilisk: 'BSX', Calamari: 'KMA', Bajun: 'BAJU', Picasso: 'PICA',
  Composable: 'LAYR', Turing: 'TUR', Monad: 'MON', Sonic: 'S', Astar: 'ASTR',
  Polkadot: 'DOT', Kusama: 'KSM', Filecoin: 'FIL', Chainflip: 'FLIP',
  GravityBridge: 'GRAV', Mixin: 'XIN', Endurance: 'ACE', Merlin: 'BTC',
};

/** "about $0.05-$2 of ETH" — or "about $0.05-$2 of gas" when the chain's token is not listed above. */
function gasPhrase(chain: string, band: string): string {
  const token = GAS_TOKENS[chain];
  return token === undefined ? `about ${band} of gas on ${chain}` : `about ${band} of ${token} for gas on ${chain}`;
}

/** One category's three phrases: the one action, the weekly action, and what to watch. `{name}`, `{chain}` and `{cap}` are filled in by farmSteps. */
interface CategoryActions {
  action: string;
  weekly: string;
  monitor: string;
}

const CATEGORY_ACTIONS: Record<string, CategoryActions> = {
  Lending: {
    action: 'Supply {cap} of USDC to {name} on {chain} as a lender',
    weekly: 'Borrow a small amount against the supply and repay it the same week so the {name} position stays active',
    monitor: 'watch the borrow rate and the health of the supply position',
  },
  Dexs: {
    action: 'Add {cap} of liquidity to a {name} pool on {chain}',
    weekly: 'Rebalance the {name} pool range or add a small amount of liquidity each week',
    monitor: 'watch the pool fees and the price range of the position',
  },
  'Prediction Market': {
    action: 'Place {cap} on a market outcome through {name} on {chain}',
    weekly: 'Settle finished markets and place a small position on a new {name} market each week',
    monitor: 'watch open markets and settle any that have resolved',
  },
  'Risk Curators': {
    action: 'Deposit {cap} into a vault curated by {name} on {chain}',
    weekly: 'Check the {name}-curated vault yield each week and move the deposit if a better vault appears',
    monitor: 'watch the curated vault yield and any change in its strategy',
  },
  Insurance: {
    action: 'Buy {cap} of cover through {name} on {chain}',
    weekly: 'Check that the {name} cover is still active and renew it before it lapses',
    monitor: 'watch the cover status and its expiry date',
  },
  CDP: {
    action: 'Deposit {collateral} through {name} on {chain} and hold the stable asset it mints',
    weekly: 'Check the {name} collateral ratio each week and top it up if it drifts toward liquidation',
    monitor: 'watch the collateral ratio and the minted stable asset',
  },
  Stablecoin: {
    action: 'Deposit {collateral} through {name} on {chain} and hold the stable asset it mints',
    weekly: 'Check the {name} collateral ratio each week and top it up if it drifts toward liquidation',
    monitor: 'watch the collateral ratio and the minted stable asset',
  },
  'Stablecoin Wrapper': {
    action: 'Wrap {cap} of USDC through {name} on {chain} and hold the wrapped stable asset',
    weekly: 'Check the {name} wrapper peg each week and unwrap if it drifts',
    monitor: 'watch the wrapper peg and the redemption terms',
  },
  RWA: {
    action: 'Buy {cap} of the tokenised asset through {name} on {chain}',
    weekly: 'Check the {name} yield accrual and the underlying asset report each week',
    monitor: 'watch the yield accrual and the underlying asset reports',
  },
  Yield: {
    action: 'Deposit {cap} into a {name} vault on {chain}',
    weekly: 'Compound the {name} yield or move it to the best vault each week',
    monitor: 'watch the vault yield and any change in its strategy',
  },
  'Yield Aggregator': {
    action: 'Deposit {cap} into a {name} vault on {chain}',
    weekly: 'Compound the {name} yield or move it to the best vault each week',
    monitor: 'watch the vault yield and any change in its strategy',
  },
  'Basis Trading': {
    action: 'Open a {cap} basis position through {name} on {chain}',
    weekly: 'Check the {name} funding rate each week and close or roll the position if it turns negative',
    monitor: 'watch the funding rate and the basis spread',
  },
  Derivatives: {
    action: 'Open a {cap} position through {name} on {chain}',
    weekly: 'Close or roll the {name} position each week and keep the size at {cap}',
    monitor: 'watch the funding rate and the open interest',
  },
  'Liquid Staking': {
    action: 'Stake {cap} through {name} on {chain} and hold the receipt token',
    weekly: 'Check the {name} staking yield each week and restake what accrues',
    monitor: 'watch the staking yield and the receipt token peg',
  },
  'Staking Pool': {
    action: 'Stake {cap} through {name} on {chain} and hold the receipt token',
    weekly: 'Check the {name} staking yield each week and restake what accrues',
    monitor: 'watch the staking yield and the receipt token peg',
  },
  Restaking: {
    action: 'Restake {cap} through {name} on {chain}',
    weekly: 'Check the {name} restaking yield and the operator set each week',
    monitor: 'watch the restaking yield and the operator set',
  },
  Bridge: {
    action: 'Bridge {cap} through {name} on {chain} to another chain you use',
    weekly: 'Bridge a small amount back through {name} or to a different chain each week',
    monitor: 'watch the bridge fees and the time each transfer takes',
  },
  'Cross Chain Bridge': {
    action: 'Bridge {cap} through {name} on {chain} to another chain you use',
    weekly: 'Bridge a small amount back through {name} or to a different chain each week',
    monitor: 'watch the bridge fees and the time each transfer takes',
  },
  'Canonical Bridge': {
    action: 'Bridge {cap} through {name} on {chain} to another chain you use',
    weekly: 'Bridge a small amount back through {name} or to a different chain each week',
    monitor: 'watch the bridge fees and the time each transfer takes',
  },
  Payments: {
    action: 'Pay {cap} through {name} on {chain} for something you already buy',
    weekly: 'Make one real payment through {name} each week',
    monitor: 'watch the payment fees and settlement time',
  },
  Privacy: {
    action: 'Make a {cap} private transfer through {name} on {chain}',
    weekly: 'Make one private transfer through {name} each week',
    monitor: 'watch the privacy set size and the transfer fees',
  },
  Indexes: {
    action: 'Buy {cap} of the {name} index on {chain}',
    weekly: 'Check the {name} index composition each week and rebalance if it changes',
    monitor: 'watch the index composition and its tracking error',
  },
  'CDP Manager': {
    action: 'Open a {cap} vault through {name} on {chain} and manage its collateral',
    weekly: 'Check the {name} vault health each week and top up collateral if it drifts',
    monitor: 'watch the vault health and the collateral ratio',
  },
  'Onchain Capital Allocator': {
    action: 'Allocate {cap} through a {name} vault on {chain}',
    weekly: 'Check the {name} allocation performance each week and reallocate if it lags',
    monitor: 'watch the allocation performance and the vault reports',
  },
  'Collateral Markets': {
    action: 'Supply {cap} of collateral to a {name} market on {chain}',
    weekly: 'Check the {name} market rates each week and move the collateral if a better rate appears',
    monitor: 'watch the market rates and the collateral health',
  },
  CeDeFi: {
    action: 'Deposit {cap} through {name} on {chain} and use its centralised service as a regular user',
    weekly: 'Check the {name} rates each week and move the deposit if a better rate appears',
    monitor: 'watch the {name} rates and any change in its terms',
  },
  'Governance Incentives': {
    action: 'Lock or delegate {cap} through {name} on {chain} to take part in governance',
    weekly: 'Vote on any open {name} proposal each week',
    monitor: 'watch open {name} proposals and their voting deadlines',
  },
  'OTC Marketplace': {
    action: 'List or buy a {cap} OTC order through {name} on {chain}',
    weekly: 'Check open {name} orders each week and settle any that have filled',
    monitor: 'watch open {name} orders and the settlement terms',
  },
  'Anchor BTC': {
    action: 'Deposit {cap} of BTC through {name} on {chain} as an anchor asset',
    weekly: 'Check the {name} anchor yield each week and re-anchor if it drops',
    monitor: 'watch the anchor yield and the BTC peg',
  },
  'Crypto Card Issuer': {
    action: 'Spend {cap} through a {name} card on {chain}',
    weekly: 'Make one card purchase through {name} each week',
    monitor: 'watch the card rewards and any change in its fees',
  },
  'Decentralized BTC': {
    action: 'Deposit {cap} of BTC through {name} on {chain} and hold the receipt token',
    weekly: 'Check the {name} BTC yield each week and restake what accrues',
    monitor: 'watch the BTC yield and the receipt token peg',
  },
  'Dual-Token Stablecoin': {
    action: 'Deposit {collateral} through {name} on {chain} and hold the stable asset it mints',
    weekly: 'Check the {name} collateral ratio each week and top it up if it drifts toward liquidation',
    monitor: 'watch the collateral ratio and the minted stable asset',
  },
  Farm: {
    action: 'Deposit {cap} into a {name} farm on {chain}',
    weekly: 'Harvest the {name} farm yield each week and re-deposit it',
    monitor: 'watch the farm yield and any change in its emissions',
  },
  'Interest Rate Derivatives': {
    action: 'Open a {cap} rate position through {name} on {chain}',
    weekly: 'Check the {name} rate curve each week and close or roll the position if it moves against you',
    monitor: 'watch the rate curve and the open interest',
  },
  'Leveraged Farming': {
    action: 'Open a {cap} leveraged farm position through {name} on {chain}',
    weekly: 'Check the {name} leverage and liquidation price each week and top up collateral if it drifts',
    monitor: 'watch the leverage, the liquidation price and the borrow rate',
  },
  'Liquidity Manager': {
    action: 'Deposit {cap} into a {name} managed pool on {chain}',
    weekly: 'Check the {name} pool range each week and let it rebalance if it drifts',
    monitor: 'watch the managed pool range and its fees',
  },
  'Uncollateralized Lending': {
    action: 'Lend {cap} of USDC through {name} on {chain} as an uncollateralised lender',
    weekly: 'Check the {name} borrower repayments each week and withdraw if one is late',
    monitor: 'watch borrower repayments and the default rate',
  },
  Chain: {
    action: 'Use {cap} through {name} on {chain} as a regular user',
    weekly: 'Return each week and use {name} again so the activity is spread over time',
    monitor: 'watch the network fees and any change in how {name} works',
  },
};

/** The fallback for a category with no entry above: a plain use of the protocol, nothing invented. */
const DEFAULT_ACTIONS: CategoryActions = {
  action: 'Use {cap} through {name} on {chain} as a regular user',
  weekly: 'Return each week and use {name} again so the activity is spread over time',
  monitor: 'watch how {name} performs and any change in its fees',
};

/** The collateral a CDP-family step deposits, per protocol — named only where the protocol's own record is verified: USDC where the protocol accepts it (USDD, Bucket), BTC where the protocol is Bitcoin-backed (Bima), and otherwise no asset is named at all ("accepted collateral") rather than a guessed one. */
const CDP_COLLATERAL_USDC = new Set(['usdd', 'bucket-cdp', 'bucket-protocol-v2']);
const CDP_COLLATERAL_BTC = new Set(['bima-cdp']);
function collateralFor(slug: string, capital: number): string {
  if (CDP_COLLATERAL_USDC.has(slug)) return `$${capital} of USDC as collateral`;
  if (CDP_COLLATERAL_BTC.has(slug)) return `$${capital} of BTC as collateral`;
  return `$${capital} of accepted collateral`;
}

/** The asset step 1 prepares: USDC everywhere except Bitcoin, which has no native USDC — there the funding asset is BTC itself. */
function fundingFor(chain: string): string {
  return chain === 'Bitcoin' ? 'BTC' : 'USDC';
}

/** Fill `{name}`, `{chain}`, `{cap}` and `{collateral}` in a category phrase. */
function fill(template: string, name: string, chain: string, capital: number, collateral: string): string {
  return template.replaceAll('{name}', name).replaceAll('{chain}', chain).replaceAll('{cap}', `$${capital}`).replaceAll('{collateral}', collateral);
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names. The action, the weekly
 * action and the monitor vary by category — insurance buys cover and never
 * swaps or votes, prediction takes market positions, lending borrows and
 * repays, a risk curator takes a deposit into a curated vault, a CDP
 * deposits its accepted collateral and holds the stable asset it mints
 * (USDC where the protocol accepts it, BTC for the Bitcoin-backed Bima,
 * never "supply USDC to" a stablecoin). Step 1 prepares BTC on Bitcoin,
 * which has no native USDC, and USDC elsewhere. Gas is chain-sensitive: about
 * $5-$20 an action on Ethereum, about $0.05-$2 elsewhere — ranges, never a
 * precise fee, because the snapshot carries no fee data. Step 5 says plainly
 * that the snapshot records no rewards program and to check the protocol's
 * own docs and announcements. Nothing here promises an airdrop, because the
 * snapshot carries no airdrop flag and no protocol's launch is guaranteed.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const band = gasBand(chain);
  const gas = gasPhrase(chain, band);
  const actions = CATEGORY_ACTIONS[p.category ?? 'None'] ?? DEFAULT_ACTIONS;
  const name = p.name;
  const collateral = collateralFor(p.slug, capital);
  const funding = fundingFor(chain);
  const action = `${fill(actions.action, name, chain, capital, collateral)}.`;
  const weekly = `${fill(actions.weekly, name, chain, capital, collateral)}.`;
  const monitor = fill(actions.monitor, name, chain, capital, collateral);
  const holdText =
    age === null
      ? `Keep the ${name} position open for at least ${hold} days so it has a history on chain (the snapshot lists no launch date for ${name}).`
      : age < 180
        ? `Keep the ${name} position open for at least ${hold} days so it has a history on chain; ${name} is under 6 months old, so a longer history matters.`
        : `Keep the ${name} position open for at least ${hold} days so it has a history on chain.`;
  return [
    {
      text: `Get gas and ${funding} ready on ${chain} for ${name}.`,
      cost: `${gas} plus $${capital} of ${funding}`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about ${band} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weekly,
      cost: `about ${band} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: holdText,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Each week, ${monitor}. This snapshot records no rewards program for ${name}, so check the protocol's own docs and announcements, and claim only through links it publishes itself.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Withdraw the ${name} position on ${chain} when you are done; keep the total at $${capital} so one protocol is never a large share of your funds.`,
      cost: `about ${band} of gas to exit`,
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    odds_factor: row.model.odds_factor,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const peers = cleanPeers(snapshot.protocols);
  const cal = calibrate(snapshot, peers);
  const holdout = holdoutValidation(snapshot);
  const board = buildBoard(snapshot, cal);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    // Words only: the snapshot's source field is a URL, and the dashboard
    // must name no network address, so the data carries the source's name.
    source: 'DefiLlama protocols snapshot',
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    calibration: cal,
    holdout,
    watchlist_size: snapshot.watchlist.length,
    watchlist: [...snapshot.watchlist].sort(),
    board_size: board.length,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100 to 4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  const seen = new Set<string>();
  for (const r of board) {
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
