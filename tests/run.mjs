// Token Radar tests — plain node, no dependencies.
//
//   node tests/run.mjs [--input <snapshot.json>] [--output <dir>]
//
// Covers: snapshot parsing, watchlist coverage, board sorting and
// monotonicity, farm-step bounds, the model hold-out numbers, the dashboard's
// own model (app.js) reproducing board.json row by row, the dashboard's size
// and zero-network rule, and determinism (main.ts run twice, every output
// file byte-compared). Exits non-zero on the first failure; prints the real
// measured numbers on success.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { MODEL, boardIssue, buildRadar, farmSteps, impliedValue, parseSnapshot, stepText } from '../lib/model.ts';

const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 || i + 1 >= argv.length ? null : argv[i + 1];
};
const inputPath = flag('--input') ?? '/home/hatch/workspace/makefun/token-radar-01-kit/token-radar-01-kit/input/snapshot.json';
const outDir = flag('--output') ?? '/tmp/radar-test-out';

/* Build the output fresh, so the tests check what main.ts actually writes. */
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
execFileSync('node', ['main.ts', '--input', inputPath, '--output', outDir], { cwd: repoDir, stdio: 'pipe' });

let passed = 0;
function check(name, ok, detail = '') {
  if (!ok) {
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    process.exit(1);
  }
  passed++;
  console.log(`ok   ${name}${detail ? ` — ${detail}` : ''}`);
}
function throws(name, fn) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  check(name, threw);
}

/* 1 — snapshot parsing */
const snapshotText = readFileSync(inputPath, 'utf8');
const snapshot = parseSnapshot(snapshotText);
check('snapshot parses: 758 protocols, 40 watchlist', snapshot.protocols.length === 758 && snapshot.watchlist.length === 40, `${snapshot.protocols.length} protocols, as_of ${snapshot.as_of}`);
throws('snapshot rejects non-JSON', () => parseSnapshot('not json'));
throws('snapshot rejects a missing as_of', () => parseSnapshot(JSON.stringify({ ...snapshot, as_of: undefined })));
throws('snapshot rejects a missing watchlist', () => parseSnapshot(JSON.stringify({ ...snapshot, watchlist: 'nope' })));

/* 2 — the board */
const { board, radar } = buildRadar(snapshot);
check('board self-validates', boardIssue(board, snapshot) === null, boardIssue(board, snapshot) ?? 'no issue');
check('watchlist coverage 40/40', snapshot.watchlist.every((s) => board.some((r) => r.slug === s)));
check('board has 198 rows', board.length === 198, `${board.length} rows`);
const ranks = board.map((r) => r.rank);
check('ranks are exactly 1..N', ranks.every((r, i) => r === i + 1));
check('implied values non-increasing with rank', board.every((r, i) => i === 0 || r.implied_value_usd <= board[i - 1].implied_value_usd));
check('implied values are not all equal', board[0].implied_value_usd !== board[board.length - 1].implied_value_usd, `$${board[0].implied_value_usd} -> $${board[board.length - 1].implied_value_usd}`);
check('every board slug is in the snapshot', board.every((r) => snapshot.protocols.some((p) => p.slug === r.slug)));
check('top row is the model’s own result', board[0].slug === 'steakhouse-financial' && board[0].implied_value_usd === 350856888, `${board[0].slug} $${board[0].implied_value_usd}`);
check('polymarket is no longer inflated by a single-peer multiple', board.find((r) => r.slug === 'polymarket-international').rank === 9 && board.find((r) => r.slug === 'polymarket-international').implied_value_usd === 53334131, `rank ${board.find((r) => r.slug === 'polymarket-international').rank}`);

/* 3 — farm steps */
let stepMin = Infinity;
let stepMax = 0;
for (const row of board) {
  check(`farm steps for ${row.slug}`, row.farm_steps.length >= 3 && row.farm_steps.length <= 12, `${row.farm_steps.length} steps`);
  for (const s of row.farm_steps) {
    stepMin = Math.min(stepMin, s.trim().length);
    stepMax = Math.max(stepMax, s.trim().length);
    if (s.trim().length < 20 || s.trim().length > 600) {
      check(`farm step bounds for ${row.slug}`, false, `${s.trim().length} chars`);
    }
  }
}
check('farm step lengths within 20..600 chars', stepMin >= 20 && stepMax <= 600, `min ${stepMin}, max ${stepMax}`);
const first = snapshot.protocols.find((p) => p.slug === 'steakhouse-financial');
check('farm steps name a cost and a time', farmSteps(first, 543).every((s) => stepText(s).includes('Cost:') && stepText(s).includes('Time:')));

/* 3b — farm-step diversity: the audit found 51 distinct step strings in the 40 watchlist rows; v2 must be far above that. */
{
  const wlRows = board.filter((r) => snapshot.watchlist.includes(r.slug));
  const wlSteps = wlRows.flatMap((r) => r.farm_steps);
  const rawDistinct = new Set(wlSteps).size;
  const stripped = wlSteps.map((s) => {
    const row = wlRows.find((r) => r.farm_steps.includes(s));
    return row ? s.split(row.name).join('{name}') : s;
  });
  const strippedDistinct = new Set(stripped).size;
  console.log(`     farm diversity (watchlist 40 rows): raw distinct ${rawDistinct}/240, name-stripped ${strippedDistinct}/240`);
  check('farm diversity: watchlist raw distinct step strings >= 200/240', rawDistinct >= 200, `${rawDistinct}/240`);
  check('farm diversity: watchlist name-stripped distinct step strings >= 100/240', strippedDistinct >= 100, `${strippedDistinct}/240`);
  const usdd = board.find((r) => r.slug === 'usdd');
  check('farm: USDD never says "supply USDC to USDD"', usdd.farm_steps.every((s) => !/supply .* USDC to USDD/i.test(s)) && usdd.farm_steps.some((s) => s.includes('as collateral')), usdd.farm_steps[1]);
  const risk = board.filter((r) => r.category === 'Risk Curators');
  check('farm: Risk Curators never say "cover" — they deposit into a curated vault', risk.length === 34 && risk.every((r) => r.farm_steps.every((s) => !/cover/i.test(s))) && risk.every((r) => r.farm_steps[1].includes('vault curated by')), `${risk.length} rows`);
  const bima = board.find((r) => r.slug === 'bima-cdp');
  check('farm: Bima deposits BTC as collateral, never USDC', bima.farm_steps[1].includes('BTC as collateral') && !/USDC as collateral/.test(bima.farm_steps[1]), bima.farm_steps[1]);
  const btcRows = board.filter((r) => r.chains[0] === 'Bitcoin');
  check('farm: Bitcoin-first rows prepare BTC, never USDC', btcRows.length === 7 && btcRows.every((r) => r.farm_steps[0].includes('BTC ready') && !r.farm_steps[0].includes('USDC ready')), `${btcRows.length} rows`);
  const cdpNeutral = board.filter((r) => ['CDP', 'Dual-Token Stablecoin', 'Stablecoin'].includes(r.category) && !['usdd', 'bucket-cdp', 'bucket-protocol-v2', 'bima-cdp'].includes(r.slug));
  check('farm: unverified CDP collateral is "accepted collateral", never a guessed asset', cdpNeutral.length === 8 && cdpNeutral.every((r) => r.farm_steps[1].includes('accepted collateral')), `${cdpNeutral.length} rows`);
  check('farm: every step 5 says the snapshot records no rewards program', board.every((r) => r.farm_steps[4].includes('records no rewards program')), 'step 5 of all 198 rows');
  check('farm: no step promises an airdrop', board.every((r) => r.farm_steps.every((s) => !/airdrop/i.test(s))), 'no "airdrop" in any step');
  const eth = board.find((r) => r.chains[0] === 'Ethereum');
  check('farm: Ethereum gas band is $5-$20, other chains $0.05-$2', eth.farm_steps[0].includes('$5-$20') && board.find((r) => r.chains[0] === 'Base').farm_steps[0].includes('$0.05-$2'), eth.farm_steps[0]);
}

/* 4 — hold-out validation: real measured numbers, and the calibration must buy scale */
const hold = radar.holdout;
console.log(`     hold-out (fit ${hold.fit_n}, test ${hold.test_n}): TVL-only Spearman ${hold.tvl_only.spearman.toFixed(3)} MdAPE ${hold.tvl_only.mdape_pct.toFixed(1)}%; global Spearman ${hold.global_median.spearman.toFixed(3)} MdAPE ${hold.global_median.mdape_pct.toFixed(1)}%; full Spearman ${hold.full_model.spearman.toFixed(3)} MdAPE ${hold.full_model.mdape_pct.toFixed(1)}%`);
check('hold-out: full model median error beats raw TVL', hold.full_model.mdape_pct < hold.tvl_only.mdape_pct, `${hold.full_model.mdape_pct.toFixed(1)}% < ${hold.tvl_only.mdape_pct.toFixed(1)}%`);
check('hold-out: correlations are in range', [hold.tvl_only, hold.global_median, hold.full_model].every((v) => v.spearman >= -1 && v.spearman <= 1 && v.mdape_pct > 0));
check('hold-out: full model median error is about 92%, not a fabricated round number', hold.full_model.mdape_pct > 85 && hold.full_model.mdape_pct < 100, `${hold.full_model.mdape_pct.toFixed(1)}%`);
check('hold-out: honest numbers (leave-one-out odds)', Math.abs(hold.full_model.spearman - 0.438) < 0.01 && Math.abs(hold.full_model.mdape_pct - 92.5) < 1.5, `Spearman ${hold.full_model.spearman.toFixed(3)}, MdAPE ${hold.full_model.mdape_pct.toFixed(1)}%`);
check('hold-out: the model does not beat TVL on rank — and says so', hold.full_model.spearman < hold.tvl_only.spearman, `full ${hold.full_model.spearman.toFixed(3)} < TVL-only ${hold.tvl_only.spearman.toFixed(3)}`);
check('calibration: 128 peers, global multiple 0.2138', radar.calibration.peers_n === 128 && Math.abs(radar.calibration.global_multiple - 0.2138) < 0.001, `peers ${radar.calibration.peers_n}, global ${radar.calibration.global_multiple.toFixed(4)}`);
check('calibration: no category multiple above 2x the global median', Object.values(radar.calibration.category_multiples).every((m) => m <= 2 * radar.calibration.global_multiple + 1e-9), `max ${Math.max(...Object.values(radar.calibration.category_multiples)).toFixed(4)}, cap ${(2 * radar.calibration.global_multiple).toFixed(4)}`);
check('calibration: a 1-peer category falls back to the global median', Math.abs(radar.calibration.category_multiples['Risk Curators'] - radar.calibration.global_multiple) < 1e-9 && radar.calibration.category_peer_n['Risk Curators'] === 1, `Risk Curators ${radar.calibration.category_multiples['Risk Curators'].toFixed(4)} from ${radar.calibration.category_peer_n['Risk Curators']} peer`);
check('calibration: the model version is radar-2', radar.model_version === 'radar-2' && MODEL.min_peers === 3 && MODEL.multiple_cap_x_global === 2);

/* 5 — the dashboard's own model reproduces board.json row by row */
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(outDir, 'data.js'), 'utf8'), sandbox);
vm.runInContext(readFileSync(join(repoDir, 'dashboard', 'app.js'), 'utf8'), sandbox);
check('app.js defines the model functions', typeof sandbox.impliedOf === 'function' && typeof sandbox.farmSteps === 'function' && typeof sandbox.oddsOf === 'function');
check('app.js MODEL matches lib/model.ts MODEL', JSON.stringify(sandbox.MODEL) === JSON.stringify(MODEL));
const R = sandbox.window.RADAR;
let mismatch = 0;
for (const row of board) {
  if (sandbox.impliedOf(row, R.calibration) !== row.implied_value_usd) mismatch++;
  const steps = sandbox.farmSteps(row);
  if (JSON.stringify(steps) !== JSON.stringify(row.farm_steps)) mismatch++;
}
check('app.js impliedOf + farmSteps match board.json on all 198 rows', mismatch === 0, `${mismatch} mismatches`);
const probe = board[0];
const v = impliedValue(snapshot.protocols.find((p) => p.slug === probe.slug), snapshot, radar.calibration);
check('lib/model.ts impliedValue matches the board row', v.implied === probe.implied_value_usd, `$${v.implied}`);

/* 6 — dashboard size and zero-network rule */
const dashFiles = readdirSync(join(repoDir, 'dashboard')).filter((n) => statSync(join(repoDir, 'dashboard', n)).isFile());
const dashBytes = dashFiles.reduce((a, n) => a + statSync(join(repoDir, 'dashboard', n)).size, 0);
check('dashboard source is within 64 KB', dashBytes <= 65536, `${dashBytes} bytes across ${dashFiles.length} files`);
for (const name of dashFiles) {
  const text = readFileSync(join(repoDir, 'dashboard', name), 'utf8');
  check(`no network address in dashboard/${name}`, !/https?:\/\//.test(text));
}
const dataJs = readFileSync(join(outDir, 'data.js'), 'utf8');
check('no network address in data.js', !/https?:\/\//.test(dataJs));

/* 7 — wording and compliance files */
{
  const indexHtml = readFileSync(join(repoDir, 'dashboard', 'index.html'), 'utf8');
  const appJs = readFileSync(join(repoDir, 'dashboard', 'app.js'), 'utf8');
  check('wording: index.html says "records no token"', indexHtml.includes('records no token'));
  check('wording: index.html has no "no token yet" / "no token exists yet"', !/no token yet/i.test(indexHtml) && !/no token exists yet/i.test(indexHtml));
  check('wording: app.js has no "no token exists yet"', !/no token exists yet/i.test(appJs));
  check('wording: footer credits lib/model.ts at build time', indexHtml.includes('lib/model.ts'));
  check('README.md exists with the three make.fun badges', existsSync(join(repoDir, 'README.md')) && ['badge/token-radar-01.svg', 'rank.svg', 'reward.svg'].every((b) => readFileSync(join(repoDir, 'README.md'), 'utf8').includes(b)) && !readFileSync(join(repoDir, 'README.md'), 'utf8').includes('{owner}'));
  check('README.md carries the referral link', readFileSync(join(repoDir, 'README.md'), 'utf8').includes('https://make.fun/?ref=813p8r7k'));
  check('.makefun/owner.json names the @epep-max agent wallet', JSON.parse(readFileSync(join(repoDir, '.makefun', 'owner.json'), 'utf8')).wallet === '2hFrGrPQLGBs3q1cyUktvUuRkKw3euv4F87Ea435i7mC');
  check('dashboard supports a filtered board view (category filter + #/filter/ route)', indexHtml.includes('id="cat"') && appJs.includes('#/filter/'));
  const dashText = dashFiles.map((n) => readFileSync(join(repoDir, 'dashboard', n), 'utf8')).join('\n');
  check('wording: no "no token exists" anywhere in the dashboard', !/no token exists/i.test(dashText));
}

/* 8 — determinism: main.ts twice, every output file byte-compared */
const runA = '/tmp/radar-det-a';
const runB = '/tmp/radar-det-b';
for (const dir of [runA, runB]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync('node', ['main.ts', '--input', inputPath, '--output', dir], { cwd: repoDir, stdio: 'pipe' });
}
function listFiles(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, `${base}${name}/`));
    else out.push(`${base}${name}`);
  }
  return out;
}
const filesA = listFiles(runA);
const filesB = listFiles(runB);
check('determinism: the two runs write the same file list', JSON.stringify(filesA) === JSON.stringify(filesB), `${filesA.length} files`);
let diff = 0;
for (const f of filesA) {
  if (!readFileSync(join(runA, f)).equals(readFileSync(join(runB, f)))) diff++;
}
check('determinism: every output file is byte-identical across runs', diff === 0, `${diff} files differ`);
check('determinism: the built /output matches a fresh run', readFileSync(join(outDir, 'dossier.json')).equals(readFileSync(join(runA, 'dossier.json'))));

console.log(`\n${passed} checks passed.`);
