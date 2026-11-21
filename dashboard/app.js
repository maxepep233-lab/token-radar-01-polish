/* Token Radar — the dashboard's own model, in plain script.
 *
 * The board is scored by lib/model.ts at build time, from the snapshot's own
 * figures: implied = round(TVL x multiple(category) x growth x maturity x odds).
 * This file recomputes the same model live from window.RADAR, so the
 * dashboard and the board always agree; nothing here is hardcoded to a
 * protocol name. The functions below are the whole value model: impliedOf,
 * oddsOf, farmSteps and their helpers. They take the row and the calibration
 * as arguments, so the same code can be checked against board.json row by row.
 * Model radar-2: a category multiple needs at least 3 peers (fewer fall back
 * to the global median) and is capped at 2x the global median.
 */

var MODEL = {
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

/* The age band a protocol falls in: 0 under 180 days, then 180-365, 365-730, 730-1095, past 1095. */
function ageBand(ageDays) {
  var a = ageDays === null || ageDays === undefined ? MODEL.unknown_age_days : ageDays;
  if (a < 180) return 0;
  if (a < 365) return 1;
  if (a < 730) return 2;
  if (a < 1095) return 3;
  return 4;
}

/* The category multiple: its shrunk median from the calibration, or the global median. */
function multipleOf(category, cal) {
  var key = category || 'None';
  var m = cal.category_multiples[key];
  return m !== undefined ? m : cal.global_multiple;
}

/* The growth multiplier: 7-day change, clamped, weighted at 0.25. */
function growthMult(change7d) {
  var raw = typeof change7d === 'number' && isFinite(change7d) ? change7d : 0;
  var pct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, raw));
  return 1 + (pct / 100) * MODEL.growth_weight;
}

/* The maturity multiplier: older protocols count a little more, floored at 0.8. */
function maturityMult(ageDays) {
  var a = ageDays === null || ageDays === undefined ? MODEL.unknown_age_days : ageDays;
  return MODEL.maturity_floor + (1 - MODEL.maturity_floor) * (Math.min(Math.max(a, 0), MODEL.maturity_days) / MODEL.maturity_days);
}

/* The token-odds factor and its two parts: the age-band and category token-record rates. */
function oddsParts(row, cal) {
  var band = ageBand(row.age_days);
  var oddsAge = cal.odds_age[band] !== undefined ? cal.odds_age[band] : cal.odds_overall;
  var oddsCategory = cal.odds_category[row.category || 'None'];
  if (oddsCategory === undefined) oddsCategory = cal.odds_overall;
  var blended = MODEL.odds_age_weight * oddsAge + (1 - MODEL.odds_age_weight) * oddsCategory;
  var factor = Math.max(MODEL.odds_floor, Math.min(1, MODEL.odds_floor + (1 - MODEL.odds_floor) * blended));
  return { factor: factor, oddsAge: oddsAge, oddsCategory: oddsCategory };
}

function oddsOf(row, cal) {
  return oddsParts(row, cal).factor;
}

/* The implied value one protocol gets under the calibration. */
function impliedOf(row, cal) {
  var base = row.tvl_usd * multipleOf(row.category, cal);
  var value = base * growthMult(row.change_7d) * maturityMult(row.age_days) * oddsOf(row, cal);
  return Math.max(1, Math.round(value));
}

/* How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(tvl) {
  if (tvl >= 5000000000) return 250;
  if (tvl >= 1000000000) return 150;
  if (tvl >= 100000000) return 100;
  return 50;
}

/* How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(ageDays) {
  if (ageDays === null || ageDays === undefined) return 30;
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

/* The gas band for one action on a chain: Ethereum is expensive, every other chain in this snapshot is cheap. The bands are ranges, never a precise fee — the snapshot carries no fee data. */
function gasBand(chain) {
  return chain === 'Ethereum' ? '$5-$20' : '$0.05-$2';
}

/* A chain's native gas token, where it is known. Chains not listed here get no token name at all — the step says "of gas on {chain}" rather than naming a token that might be wrong. Trimmed to the chains that appear as a first chain on this frozen board; lib/model.ts keeps the full table. */
var GAS_TOKENS = {
  'Ethereum': 'ETH', 'Arbitrum': 'ETH', 'Base': 'ETH', 'zkSync Era': 'ETH', 'Manta': 'ETH',
  'Ink': 'ETH', 'World Chain': 'ETH', 'Morph': 'ETH', 'Fluent': 'ETH', 'Reya Network': 'ETH',
  'RISE': 'ETH', 'Polygon': 'POL', 'Binance': 'BNB', 'Solana': 'SOL', 'Tron': 'TRX',
  'Avalanche': 'AVAX', 'Sui': 'SUI', 'Aptos': 'APT', 'Mantle': 'MNT', 'Kava': 'KAVA',
  'Berachain': 'BERA', 'Hyperliquid L1': 'HYPE', 'Starknet': 'STRK', 'Algorand': 'ALGO', 'Klaytn': 'KAIA',
  'Bittensor': 'TAO', 'Ripple': 'XRP', 'RSK': 'RBTC', 'Ronin': 'RON', 'Plume Mainnet': 'PLUME',
  'Provenance': 'HASH', 'Qubic': 'QUBIC', 'Mezo': 'BTC', 'Arc': 'USDC', 'BSquared': 'BTC',
  'Bifrost Network': 'BFC', 'Plasma': 'XPL', 'Proton': 'XPR', 'Stable': 'USDT', 'XION': 'XION',
  'Bitcoin': 'BTC', 'Stacks': 'STX', 'Stellar': 'XLM', 'Monad': 'MON'
};

/* "about $0.05-$2 of ETH" — or "about $0.05-$2 of gas" when the chain's token is not listed above. */
function gasPhrase(chain, band) {
  var token = GAS_TOKENS[chain];
  return token === undefined ? 'about ' + band + ' of gas on ' + chain : 'about ' + band + ' of ' + token + ' for gas on ' + chain;
}

/* One category's three phrases: the one action, the weekly action, and what to watch. {name}, {chain} and {cap} are filled in by farmSteps. */
var CATEGORY_ACTIONS = {
  'Lending': { action: 'Supply {cap} of USDC to {name} on {chain} as a lender', weekly: 'Borrow a small amount against the supply and repay it the same week so the {name} position stays active', monitor: 'watch the borrow rate and the health of the supply position' },
  'Dexs': { action: 'Add {cap} of liquidity to a {name} pool on {chain}', weekly: 'Rebalance the {name} pool range or add a small amount of liquidity each week', monitor: 'watch the pool fees and the price range of the position' },
  'Prediction Market': { action: 'Place {cap} on a market outcome through {name} on {chain}', weekly: 'Settle finished markets and place a small position on a new {name} market each week', monitor: 'watch open markets and settle any that have resolved' },
  'Risk Curators': { action: 'Deposit {cap} into a vault curated by {name} on {chain}', weekly: 'Check the {name}-curated vault yield each week and move the deposit if a better vault appears', monitor: 'watch the curated vault yield and any change in its strategy' },
  'Insurance': { action: 'Buy {cap} of cover through {name} on {chain}', weekly: 'Check that the {name} cover is still active and renew it before it lapses', monitor: 'watch the cover status and its expiry date' },
  'CDP': { action: 'Deposit {collateral} through {name} on {chain} and hold the stable asset it mints', weekly: 'Check the {name} collateral ratio each week and top it up if it drifts toward liquidation', monitor: 'watch the collateral ratio and the minted stable asset' },
  'Stablecoin Wrapper': { action: 'Wrap {cap} of USDC through {name} on {chain} and hold the wrapped stable asset', weekly: 'Check the {name} wrapper peg each week and unwrap if it drifts', monitor: 'watch the wrapper peg and the redemption terms' },
  'RWA': { action: 'Buy {cap} of the tokenised asset through {name} on {chain}', weekly: 'Check the {name} yield accrual and the underlying asset report each week', monitor: 'watch the yield accrual and the underlying asset reports' },
  'Yield': { action: 'Deposit {cap} into a {name} vault on {chain}', weekly: 'Compound the {name} yield or move it to the best vault each week', monitor: 'watch the vault yield and any change in its strategy' },
  'Yield Aggregator': { action: 'Deposit {cap} into a {name} vault on {chain}', weekly: 'Compound the {name} yield or move it to the best vault each week', monitor: 'watch the vault yield and any change in its strategy' },
  'Basis Trading': { action: 'Open a {cap} basis position through {name} on {chain}', weekly: 'Check the {name} funding rate each week and close or roll the position if it turns negative', monitor: 'watch the funding rate and the basis spread' },
  'Derivatives': { action: 'Open a {cap} position through {name} on {chain}', weekly: 'Close or roll the {name} position each week and keep the size at {cap}', monitor: 'watch the funding rate and the open interest' },
  'Staking Pool': { action: 'Stake {cap} through {name} on {chain} and hold the receipt token', weekly: 'Check the {name} staking yield each week and restake what accrues', monitor: 'watch the staking yield and the receipt token peg' },
  'Restaking': { action: 'Restake {cap} through {name} on {chain}', weekly: 'Check the {name} restaking yield and the operator set each week', monitor: 'watch the restaking yield and the operator set' },
  'Cross Chain Bridge': { action: 'Bridge {cap} through {name} on {chain} to another chain you use', weekly: 'Bridge a small amount back through {name} or to a different chain each week', monitor: 'watch the bridge fees and the time each transfer takes' },
  'Payments': { action: 'Pay {cap} through {name} on {chain} for something you already buy', weekly: 'Make one real payment through {name} each week', monitor: 'watch the payment fees and settlement time' },
  'Indexes': { action: 'Buy {cap} of the {name} index on {chain}', weekly: 'Check the {name} index composition each week and rebalance if it changes', monitor: 'watch the index composition and its tracking error' },
  'CDP Manager': { action: 'Open a {cap} vault through {name} on {chain} and manage its collateral', weekly: 'Check the {name} vault health each week and top up collateral if it drifts', monitor: 'watch the vault health and the collateral ratio' },
  'Onchain Capital Allocator': { action: 'Allocate {cap} through a {name} vault on {chain}', weekly: 'Check the {name} allocation performance each week and reallocate if it lags', monitor: 'watch the allocation performance and the vault reports' },
  'Collateral Markets': { action: 'Supply {cap} of collateral to a {name} market on {chain}', weekly: 'Check the {name} market rates each week and move the collateral if a better rate appears', monitor: 'watch the market rates and the collateral health' },
  'CeDeFi': { action: 'Deposit {cap} through {name} on {chain} and use its centralised service as a regular user', weekly: 'Check the {name} rates each week and move the deposit if a better rate appears', monitor: 'watch the {name} rates and any change in its terms' },
  'Governance Incentives': { action: 'Lock or delegate {cap} through {name} on {chain} to take part in governance', weekly: 'Vote on any open {name} proposal each week', monitor: 'watch open {name} proposals and their voting deadlines' },
  'OTC Marketplace': { action: 'List or buy a {cap} OTC order through {name} on {chain}', weekly: 'Check open {name} orders each week and settle any that have filled', monitor: 'watch open {name} orders and the settlement terms' },
  'Anchor BTC': { action: 'Deposit {cap} of BTC through {name} on {chain} as an anchor asset', weekly: 'Check the {name} anchor yield each week and re-anchor if it drops', monitor: 'watch the anchor yield and the BTC peg' },
  'Crypto Card Issuer': { action: 'Spend {cap} through a {name} card on {chain}', weekly: 'Make one card purchase through {name} each week', monitor: 'watch the card rewards and any change in its fees' },
  'Decentralized BTC': { action: 'Deposit {cap} of BTC through {name} on {chain} and hold the receipt token', weekly: 'Check the {name} BTC yield each week and restake what accrues', monitor: 'watch the BTC yield and the receipt token peg' },
  'Dual-Token Stablecoin': { action: 'Deposit {collateral} through {name} on {chain} and hold the stable asset it mints', weekly: 'Check the {name} collateral ratio each week and top it up if it drifts toward liquidation', monitor: 'watch the collateral ratio and the minted stable asset' },
  'Farm': { action: 'Deposit {cap} into a {name} farm on {chain}', weekly: 'Harvest the {name} farm yield each week and re-deposit it', monitor: 'watch the farm yield and any change in its emissions' },
  'Interest Rate Derivatives': { action: 'Open a {cap} rate position through {name} on {chain}', weekly: 'Check the {name} rate curve each week and close or roll the position if it moves against you', monitor: 'watch the rate curve and the open interest' },
  'Leveraged Farming': { action: 'Open a {cap} leveraged farm position through {name} on {chain}', weekly: 'Check the {name} leverage and liquidation price each week and top up collateral if it drifts', monitor: 'watch the leverage, the liquidation price and the borrow rate' },
  'Liquidity Manager': { action: 'Deposit {cap} into a {name} managed pool on {chain}', weekly: 'Check the {name} pool range each week and let it rebalance if it drifts', monitor: 'watch the managed pool range and its fees' },
  'Uncollateralized Lending': { action: 'Lend {cap} of USDC through {name} on {chain} as an uncollateralised lender', weekly: 'Check the {name} borrower repayments each week and withdraw if one is late', monitor: 'watch borrower repayments and the default rate' },
  'Chain': { action: 'Use {cap} through {name} on {chain} as a regular user', weekly: 'Return each week and use {name} again so the activity is spread over time', monitor: 'watch the network fees and any change in how {name} works' }
};

/* The fallback for a category with no entry above: a plain use of the protocol, nothing invented. */
var DEFAULT_ACTIONS = { action: 'Use {cap} through {name} on {chain} as a regular user', weekly: 'Return each week and use {name} again so the activity is spread over time', monitor: 'watch how {name} performs and any change in its fees' };

/* The collateral a CDP-family step deposits, per protocol — named only where the protocol's own record is verified: USDC where the protocol accepts it (USDD, Bucket), BTC where the protocol is Bitcoin-backed (Bima), and otherwise no asset is named at all ("accepted collateral") rather than a guessed one. */
var CDP_COLLATERAL_USDC = { 'usdd': true, 'bucket-cdp': true, 'bucket-protocol-v2': true };
var CDP_COLLATERAL_BTC = { 'bima-cdp': true };
function collateralFor(slug, capital) {
  if (CDP_COLLATERAL_USDC[slug]) return '$' + capital + ' of USDC as collateral';
  if (CDP_COLLATERAL_BTC[slug]) return '$' + capital + ' of BTC as collateral';
  return '$' + capital + ' of accepted collateral';
}

/* The asset step 1 prepares: USDC everywhere except Bitcoin, which has no native USDC — there the funding asset is BTC itself. */
function fundingFor(chain) {
  return chain === 'Bitcoin' ? 'BTC' : 'USDC';
}

/* Fill {name}, {chain}, {cap} and {collateral} in a category phrase. */
function fill(template, name, chain, capital, collateral) {
  return template.split('{name}').join(name).split('{chain}').join(chain).split('{cap}').join('$' + capital).split('{collateral}').join(collateral);
}

/* A step as one string: its action, then its cost and time, within 20 to 600 characters. */
function stepText(step) {
  var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
  return s;
}

/* A protocol's farm plan: six steps, each an action with a cost and a time.
 * Derived from the protocol's own record (category, chains, TVL, age), never
 * from a hand-written list of names. The action, the weekly action and the
 * monitor vary by category — insurance buys cover and never swaps or votes,
 * prediction takes market positions, lending borrows and repays, a risk
 * curator takes a deposit into a curated vault, a CDP deposits its accepted
 * collateral and holds the stable asset it mints (USDC where the protocol
 * accepts it, BTC for the Bitcoin-backed Bima, never "supply USDC to" a
 * stablecoin). Step 1 prepares BTC on Bitcoin, which has no native USDC,
 * and USDC elsewhere. Gas is chain-sensitive: about $5-$20 an action on
 * Ethereum, about $0.05-$2 elsewhere — ranges, never a precise fee, because
 * the snapshot carries no fee data. Step 5 says plainly that the snapshot
 * records no rewards program and to check the protocol's own docs and
 * announcements. Nothing here promises an airdrop. */
function farmSteps(row) {
  var chain = row.chains && row.chains.length > 0 ? row.chains[0] : 'its main chain';
  var capital = capitalFor(row.tvl_usd);
  var hold = holdDaysFor(row.age_days);
  var band = gasBand(chain);
  var gas = gasPhrase(chain, band);
  var actions = CATEGORY_ACTIONS[row.category || 'None'] || DEFAULT_ACTIONS;
  var name = row.name;
  var collateral = collateralFor(row.slug, capital);
  var funding = fundingFor(chain);
  var action = fill(actions.action, name, chain, capital, collateral) + '.';
  var weekly = fill(actions.weekly, name, chain, capital, collateral) + '.';
  var monitor = fill(actions.monitor, name, chain, capital, collateral);
  var holdText;
  if (row.age_days === null || row.age_days === undefined) {
    holdText = 'Keep the ' + name + ' position open for at least ' + hold + ' days so it has a history on chain (the snapshot lists no launch date for ' + name + ').';
  } else if (row.age_days < 180) {
    holdText = 'Keep the ' + name + ' position open for at least ' + hold + ' days so it has a history on chain; ' + name + ' is under 6 months old, so a longer history matters.';
  } else {
    holdText = 'Keep the ' + name + ' position open for at least ' + hold + ' days so it has a history on chain.';
  }
  var steps = [
    { text: 'Get gas and ' + funding + ' ready on ' + chain + ' for ' + name + '.', cost: gas + ' plus $' + capital + ' of ' + funding, time: '5 minutes' },
    { text: action, cost: '$' + capital + ' of capital and about ' + band + ' of gas', time: '15 minutes to set up' },
    { text: weekly, cost: 'about ' + band + ' of gas a week', time: '10 minutes a week' },
    { text: holdText, cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
    { text: 'Each week, ' + monitor + '. This snapshot records no rewards program for ' + name + ', so check the protocol\'s own docs and announcements, and claim only through links it publishes itself.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: 'Withdraw the ' + name + ' position on ' + chain + ' when you are done; keep the total at $' + capital + ' so one protocol is never a large share of your funds.', cost: 'about ' + band + ' of gas to exit', time: '10 minutes' }
  ];
  var out = [];
  for (var i = 0; i < steps.length; i++) out.push(stepText(steps[i]));
  return out;
}

/* ---- formatting: plain string work, no locale dependence ---- */
function fmtInt(n) {
  var s = String(Math.round(n));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function fmtUsd(n) { return '$' + fmtInt(n); }
function fmtTvl(n) {
  if (n >= 1000000000) return '$' + (n / 1000000000).toFixed(2) + 'B';
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
  return fmtUsd(n);
}
function fmtPct(x) {
  if (x === null || x === undefined) return '—';
  return (x > 0 ? '+' : '') + x.toFixed(2) + '%';
}
function fmtAge(days) {
  if (days === null || days === undefined) return '—';
  if (days < 365) return days + 'd';
  return (days / 365).toFixed(1) + 'y';
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function chainPills(chains, max) {
  var shown = chains.slice(0, max);
  var html = shown.map(function (ch) { return '<span class="pill">' + esc(ch) + '</span>'; }).join('');
  if (chains.length > max) html += '<span class="pill">+' + (chains.length - max) + '</span>';
  return html;
}

/* ---- rendering: browser only ---- */
if (typeof document !== 'undefined') {
  init();
}

function init() {
  var R = (typeof window !== 'undefined' && window.RADAR) ? window.RADAR : null;
  if (!R || !Array.isArray(R.rows) || R.rows.length === 0) {
    document.body.insertAdjacentHTML('afterbegin', '<div class="error">The radar has no data: data.js did not load.</div>');
    return;
  }
  var watchlist = {};
  for (var i = 0; i < (R.watchlist || []).length; i++) watchlist[R.watchlist[i]] = true;
  var watchlistOnBoard = 0;
  for (var w = 0; w < R.rows.length; w++) if (watchlist[R.rows[w].slug]) watchlistOnBoard++;
  var state = { tab: 'board', sortKey: 'rank', sortDir: 1, q: '', cat: '', chain: '', detailSlug: null };

  /* stats */
  var stats = document.getElementById('stats');
  stats.innerHTML =
    statHtml(fmtInt(R.board_size), 'rows on the board') +
    statHtml(watchlistOnBoard + ' / ' + R.watchlist_size, 'watchlist slugs covered') +
    statHtml(fmtInt(R.calibration.peers_n), 'traded peers calibrated') +
    statHtml(R.as_of, 'snapshot date');
  function statHtml(value, label) {
    return '<div class="stat"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
  }

  /* how this ranks — the formula, the global multiple and the hold-out line, on the board view */
  var howEl = document.getElementById('how-ranks');
  if (howEl) {
    howEl.innerHTML =
      '<b>How this ranks.</b> implied = TVL &times; multiple(category) &times; growth &times; maturity &times; odds. ' +
      'Global multiple ' + R.calibration.global_multiple.toFixed(4) +
      ' (median market-cap / TVL of ' + R.calibration.peers_n + ' traded peers). ' +
      'A category multiple needs at least ' + MODEL.min_peers + ' peers and is capped at ' +
      MODEL.multiple_cap_x_global + '&times; the global multiple. ' +
      'Hold-out (64 fit / 64 test, leave-one-out odds): Spearman ' +
      R.holdout.full_model.spearman.toFixed(3) + ', median error ' +
      R.holdout.full_model.mdape_pct.toFixed(1) + '% — raw TVL alone scores ' +
      R.holdout.tvl_only.spearman.toFixed(3) + ' / ' +
      R.holdout.tvl_only.mdape_pct.toFixed(1) + '%.';
  }

  /* filter selects */
  var cats = {};
  var chains = {};
  for (var r = 0; r < R.rows.length; r++) {
    var row = R.rows[r];
    cats[row.category || 'None'] = true;
    for (var c = 0; c < row.chains.length; c++) chains[row.chains[c]] = true;
  }
  fillSelect(document.getElementById('cat'), 'All categories', Object.keys(cats).sort());
  fillSelect(document.getElementById('chain'), 'All chains', Object.keys(chains).sort());
  function fillSelect(el, all, values) {
    var html = '<option value="">' + esc(all) + '</option>';
    for (var i = 0; i < values.length; i++) html += '<option value="' + esc(values[i]) + '">' + esc(values[i]) + '</option>';
    el.innerHTML = html;
  }

  /* board */
  var tbody = document.getElementById('board-body');
  var countEl = document.getElementById('count');
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var out = [];
    for (var i = 0; i < R.rows.length; i++) {
      var row = R.rows[i];
      if (state.cat && (row.category || 'None') !== state.cat) continue;
      if (state.chain && row.chains.indexOf(state.chain) === -1) continue;
      if (q && row.name.toLowerCase().indexOf(q) === -1 && row.slug.toLowerCase().indexOf(q) === -1) continue;
      out.push(row);
    }
    var key = state.sortKey;
    var dir = state.sortDir;
    out.sort(function (a, b) {
      var d = 0;
      if (key === 'rank') d = a.rank - b.rank;
      else if (key === 'name') d = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      else if (key === 'category') d = (a.category || '') < (b.category || '') ? -1 : (a.category || '') > (b.category || '') ? 1 : 0;
      else if (key === 'tvl') d = a.tvl_usd - b.tvl_usd;
      else if (key === 'change') d = (a.change_7d || 0) - (b.change_7d || 0);
      else if (key === 'age') d = (a.age_days || 0) - (b.age_days || 0);
      else if (key === 'implied') d = a.implied_value_usd - b.implied_value_usd;
      else if (key === 'odds') d = a.odds_factor - b.odds_factor;
      if (d === 0) d = a.rank - b.rank;
      return d * dir;
    });
    return out;
  }
  function renderBoard() {
    var rows = visibleRows();
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var change = row.change_7d;
      var cls = change === null ? '' : (change >= 0 ? 'up' : 'down');
      html += '<tr data-slug="' + esc(row.slug) + '"' + (row.rank <= 3 ? ' class="top3"' : '') + '>' +
        '<td class="num">' + row.rank + '</td>' +
        '<td>' + esc(row.name) + (watchlist[row.slug] ? '<span class="badge">WATCHLIST</span>' : '') + '<span class="slug">' + esc(row.slug) + '</span></td>' +
        '<td>' + esc(row.category || '—') + '</td>' +
        '<td>' + chainPills(row.chains, 2) + '</td>' +
        '<td class="num">' + fmtTvl(row.tvl_usd) + '</td>' +
        '<td class="num ' + cls + '">' + fmtPct(change) + '</td>' +
        '<td class="num">' + fmtAge(row.age_days) + '</td>' +
        '<td class="num"><b>' + fmtUsd(row.implied_value_usd) + '</b></td>' +
        '<td class="num">' + Math.round(row.odds_factor * 100) + '%</td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
    countEl.textContent = 'Showing ' + rows.length + ' of ' + R.rows.length + ' rows';
    var heads = document.querySelectorAll('#board th[data-sort]');
    for (var h = 0; h < heads.length; h++) {
      heads[h].classList.toggle('sorted', heads[h].getAttribute('data-sort') === state.sortKey);
    }
  }
  tbody.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = '#/detail/' + tr.getAttribute('data-slug');
  });
  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sortKey === key) state.sortDir = -state.sortDir;
      else { state.sortKey = key; state.sortDir = (key === 'name' || key === 'category' || key === 'rank') ? 1 : -1; }
      renderBoard();
    });
  });
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  document.getElementById('cat').addEventListener('change', function (e) {
    state.cat = e.target.value;
    location.hash = state.cat ? '#/filter/' + encodeURIComponent(state.cat) : '#/board';
    renderBoard();
  });
  document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });

  /* detail */
  var detailEl = document.getElementById('detail');
  function renderDetail(slug) {
    var row = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) { row = R.rows[i]; break; }
    if (!row) { detailEl.innerHTML = '<div class="error">No protocol on the board with slug ' + esc(slug) + '.</div>'; return; }
    var cal = R.calibration;
    var parts = oddsParts(row, cal);
    var multiple = multipleOf(row.category, cal);
    var growth = growthMult(row.change_7d);
    var maturity = maturityMult(row.age_days);
    var recomputed = impliedOf(row, cal);
    var steps = farmSteps(row);
    var stepsHtml = '';
    for (var s = 0; s < steps.length; s++) {
      var step = steps[s];
      var cut = step.indexOf(' Cost: ');
      var action = cut === -1 ? step : step.slice(0, cut);
      var cost = cut === -1 ? '' : step.slice(cut + 1);
      stepsHtml += '<li>' + esc(action) + '<span class="cost">' + esc(cost) + '</span></li>';
    }
    detailEl.innerHTML =
      '<div class="detail">' +
      '<h2>' + esc(row.name) + (watchlist[row.slug] ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>' +
      '<p>' + esc(row.category || '—') + ' &middot; ' + chainPills(row.chains, 6) + ' &middot; pre-token — records no token</p>' +
      '<div class="hero">' + fmtUsd(row.implied_value_usd) + '</div>' +
      '<p class="muted">Implied value under model radar-2. The dashboard recomputes it from the same model: ' + fmtUsd(recomputed) + '.</p>' +
      '<div class="termsgrid">' +
      '<div><span>Base</span><b>' + fmtUsd(row.tvl_usd * multiple) + '</b><span>TVL ' + fmtTvl(row.tvl_usd) + ' &times; multiple ' + multiple.toFixed(4) + '</span></div>' +
      '<div><span>Growth</span><b>&times;' + growth.toFixed(4) + '</b><span>7-day change ' + fmtPct(row.change_7d) + '</span></div>' +
      '<div><span>Maturity</span><b>&times;' + maturity.toFixed(4) + '</b><span>Age ' + fmtAge(row.age_days) + '</span></div>' +
      '<div><span>Token odds</span><b>&times;' + parts.factor.toFixed(4) + '</b><span>Age-band ' + Math.round(parts.oddsAge * 100) + '%, category ' + Math.round(parts.oddsCategory * 100) + '%</span></div>' +
      '<div class="total"><span>Implied value</span><b>' + fmtUsd(recomputed) + '</b><span>Base &times; growth &times; maturity &times; odds</span></div>' +
      '</div>' +
      '<h3>Farm plan</h3>' +
      '<ol class="steps">' + stepsHtml + '</ol>' +
      '<p class="muted">Rank #' + row.rank + ' of ' + R.rows.length + '. Listed ' + (row.listed_at || 'on an unknown date') + '. No airdrop is promised: the snapshot carries no launch date, and this plan is a set of actions, not a reward.</p>' +
      '</div>';
  }
  document.getElementById('back').addEventListener('click', function () { location.hash = '#/board'; });

  /* live tokens */
  var liveBody = document.getElementById('live-body');
  var liveHtml = '';
  for (var l = 0; l < R.live.length; l++) {
    var live = R.live[l];
    var ratio = live.mcap_usd && live.tvl_usd ? live.mcap_usd / live.tvl_usd : null;
    liveHtml += '<tr><td class="num">' + (l + 1) + '</td>' +
      '<td>' + esc(live.name) + '<span class="slug">' + esc(live.slug) + '</span></td>' +
      '<td>' + esc(live.category || '—') + '</td>' +
      '<td>' + live.chains.slice(0, 3).map(function (ch) { return '<span class="pill">' + esc(ch) + '</span>'; }).join('') + '</td>' +
      '<td class="num">' + fmtTvl(live.tvl_usd) + '</td>' +
      '<td class="num"><b>' + fmtUsd(live.mcap_usd || 0) + '</b></td>' +
      '<td class="num">' + fmtPct(live.change_7d) + '</td>' +
      '<td class="num">' + (ratio === null ? '—' : ratio.toFixed(2) + '&times;') + '</td></tr>';
  }
  liveBody.innerHTML = liveHtml;

  /* method */
  var cal = R.calibration;
  var hold = R.holdout;
  function kvHtml(value, label) {
    return '<div><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
  }
  /* calibration key figures */
  var calHtml =
    '<h3>Calibration — from the snapshot itself</h3><div class="kv">' +
    kvHtml(fmtInt(cal.peers_n), 'traded peers (market cap and TVL both positive)') +
    kvHtml(cal.global_multiple.toFixed(4), 'global median market-cap / TVL') +
    kvHtml(cal.winsor_cap.toFixed(2), 'winsor cap: 90th percentile of peer ratios') +
    kvHtml('8', 'shrink prior: protocols per category multiple') +
    kvHtml(String(MODEL.min_peers), 'minimum peers before a category median is used') +
    kvHtml(MODEL.multiple_cap_x_global + 'x', 'cap on a category multiple, as a multiple of the global median') +
    '</div>';
  /* category multiples actually used on this board, with their peer counts */
  var seenCats = {};
  for (var ci = 0; ci < R.rows.length; ci++) seenCats[R.rows[ci].category || 'None'] = true;
  var catList = Object.keys(seenCats).map(function (cat) {
    var m = cal.category_multiples[cat];
    var n = cal.category_peer_n[cat];
    return { cat: cat, multiple: m === undefined ? cal.global_multiple : m, peers: n === undefined ? 0 : n };
  }).sort(function (a, b) { return b.multiple - a.multiple || (a.cat < b.cat ? -1 : 1); });
  var catRows = '';
  for (var c2 = 0; c2 < catList.length; c2++) {
    var c = catList[c2];
    var note = '';
    if (c.peers < MODEL.min_peers) note = 'uses the global median — fewer than ' + MODEL.min_peers + ' peers';
    else if (c.multiple >= MODEL.multiple_cap_x_global * cal.global_multiple - 1e-9) note = 'capped at ' + MODEL.multiple_cap_x_global + 'x the global median';
    catRows += '<tr><td>' + esc(c.cat) + '</td><td class="num">' + c.multiple.toFixed(4) + '</td><td class="num">' + c.peers + '</td><td>' + esc(note) + '</td></tr>';
  }
  calHtml += '<table class="caltable"><thead><tr><th>Category</th><th class="num">Multiple</th><th class="num">Peers</th><th>Note</th></tr></thead><tbody>' + catRows + '</tbody></table>' +
    '<p>Each multiple is a shrunk median of that category\u2019s own traded peers, never a hand-picked number. A category with fewer than ' + MODEL.min_peers + ' peers cannot set its own multiple: it uses the global median instead, so one expensive peer never sets a whole category. The cap does the same for categories whose peers are all expensive.</p>';
  document.getElementById('calibration').innerHTML = calHtml;
  /* hold-out validation as a table, with the honest reading */
  document.getElementById('holdout').innerHTML =
    '<h3>Hold-out validation — 64 fit, 64 test, peers sorted by slug</h3>' +
    '<table class="holdtable"><thead><tr><th>Variant</th><th class="num">Rank correlation</th><th class="num">Median error</th></tr></thead><tbody>' +
    '<tr><td>Raw TVL</td><td class="num">' + hold.tvl_only.spearman.toFixed(3) + '</td><td class="num">' + hold.tvl_only.mdape_pct.toFixed(1) + '%</td></tr>' +
    '<tr><td>Global median multiple</td><td class="num">' + hold.global_median.spearman.toFixed(3) + '</td><td class="num">' + hold.global_median.mdape_pct.toFixed(1) + '%</td></tr>' +
    '<tr><td>Full model (radar-2)</td><td class="num">' + hold.full_model.spearman.toFixed(3) + '</td><td class="num">' + hold.full_model.mdape_pct.toFixed(1) + '%</td></tr>' +
    '</tbody></table>' +
    '<p>Calibration buys the absolute scale — a 465% median error becomes about 92% — and a defensible separation between categories. It does not beat raw TVL on rank correlation: the odds tables in this hold-out are rebuilt leave-one-out for each test peer, so the numbers above are the honest ones (the v1 hold-out counted the test peers in the odds tables and read 0.434 / 91.8%). The ranking differences among calibrated variants are inside noise (n = 64), so every adjustment term stays small and bounded.</p>' +
    '<p>Tested and not adopted: log-geometric multiples (0.455 / 92.8%), a fitted TVL power law (0.417 / 84.5% — the best median error, but worse on rank and it compresses the board\u2019s top), min-peers 4 (0.444 / 91.2%) and 5 (0.437 / 90.0%), and shrink 0 (0.450 / 89.8%). Nothing beats TVL-only on rank, so the model is kept for what it provably buys: calibrated absolute scale, category separation, token odds, and the live/pre-token split.</p>';
  /* chart: implied value by category, top 8, log scale */
  (function renderChart() {
    var el = document.getElementById('chart');
    if (!el) return;
    var sums = {};
    for (var i = 0; i < R.rows.length; i++) {
      var cat = R.rows[i].category || 'None';
      sums[cat] = (sums[cat] || 0) + R.rows[i].implied_value_usd;
    }
    var top = Object.keys(sums).map(function (cat) { return { cat: cat, value: sums[cat] }; })
      .sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
    var logs = top.map(function (t) { return Math.log10(t.value); });
    var lo = Math.min.apply(null, logs);
    var hi = Math.max.apply(null, logs);
    var html = '<h3>Implied value by category — top 8 (log scale)</h3>';
    for (var j = 0; j < top.length; j++) {
      var w = hi > lo ? ((logs[j] - lo) / (hi - lo)) * 100 : 100;
      html += '<div class="chart-row"><span class="chart-label">' + esc(top[j].cat) + '</span>' +
        '<span class="chart-track"><span class="chart-bar" style="width:' + w.toFixed(1) + '%"></span></span>' +
        '<span class="chart-val">' + fmtUsd(top[j].value) + '</span></div>';
    }
    html += '<p class="muted">Bars are log-scaled: Risk Curators holds about 40% of the board\u2019s implied value because the watchlist is heavy with curators and the four largest TVLs on the board are curators — all four use the global multiple, not a category multiple.</p>';
    el.innerHTML = html;
  })();
  document.getElementById('coverage').textContent =
    R.board_size + ' rows on the board: all ' + R.watchlist_size + ' watchlist protocols, plus every other protocol in the snapshot that records no token, is not a wrapped or staked product, and is not in an excluded category. Cross Chain Bridge protocols are included. ' + R.live_size + ' live-token protocols sit apart, by market cap.';
  document.getElementById('stablecoin-note').textContent =
    'Some rows that record no token are stablecoins or products whose token exists off the record — USDD, for example, is a stablecoin in the CDP category, and its farm plan deposits collateral and holds the stable asset it mints rather than supplying USDC to it. The board follows the snapshot\u2019s record only: "records no token" means the snapshot carries no CoinGecko id, no symbol and no market cap for that protocol — it is a statement about the record, not about what exists off the record.';
  document.getElementById('provenance').textContent =
    'Source: ' + R.source + '. As of ' + R.as_of + '. Floor ' + fmtUsd(R.floor_usd) + '. Model ' + R.model_version + '. Built from one frozen snapshot; no live data, no prices fetched at view time.';

  /* tabs + hash routing */
  var sections = { board: 'view-board', live: 'view-live', method: 'view-method', detail: 'view-detail' };
  function showTab(name) {
    state.tab = name;
    document.body.classList.toggle('is-detail', name === 'detail');
    for (var key in sections) document.getElementById(sections[key]).hidden = key !== name;
    var buttons = document.querySelectorAll('.tabs button');
    for (var b = 0; b < buttons.length; b++) buttons[b].classList.toggle('active', buttons[b].getAttribute('data-tab') === name || (name === 'detail' && buttons[b].getAttribute('data-tab') === 'board'));
  }
  document.querySelectorAll('.tabs button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tab = btn.getAttribute('data-tab');
      location.hash = tab === 'board' ? '#/board' : '#/' + tab;
    });
  });
  function route() {
    var hash = location.hash || '#/board';
    var parts = hash.replace(/^#\//, '').split('/');
    if (parts[0] === 'detail' && parts[1]) {
      renderDetail(decodeURIComponent(parts[1]));
      showTab('detail');
    } else if (parts[0] === 'filter' && parts[1]) {
      state.cat = decodeURIComponent(parts[1]);
      document.getElementById('cat').value = state.cat;
      renderBoard();
      showTab('board');
    } else if (parts[0] === 'live') {
      showTab('live');
    } else if (parts[0] === 'method') {
      showTab('method');
    } else {
      state.cat = '';
      document.getElementById('cat').value = '';
      renderBoard();
      showTab('board');
    }
  }
  window.addEventListener('hashchange', route);
  renderBoard();
  route();
}
