// Token Radar gate check — plain node, no dependencies.
//
//   node tests/gate.mjs [--input <snapshot.json>] [--output <dir>]
//
// Checks all 7 gate rows from RULES.txt against a freshly built /output:
// dashboard_files, board_file, sorted_by_value, coverage, farm_steps,
// screenshots, dossier_matches. Exits non-zero on the first failing row.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from '../vendor/makefun-board.ts';

const repoDir = dirname(dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 || i + 1 >= argv.length ? null : argv[i + 1];
};
const inputPath = flag('--input') ?? '/home/hatch/workspace/makefun/token-radar-01-kit/token-radar-01-kit/input/snapshot.json';
const outDir = flag('--output') ?? '/tmp/radar-test-out';

let rows = 0;
function pass(name, detail) {
  rows++;
  console.log(`PASS ${name} — ${detail}`);
}
function fail(name, detail) {
  console.error(`FAIL ${name} — ${detail}`);
  process.exit(1);
}

/* Build the output fresh. */
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
execFileSync('node', ['main.ts', '--input', inputPath, '--output', outDir], { cwd: repoDir, stdio: 'pipe' });

const snapshot = JSON.parse(readFileSync(inputPath, 'utf8'));
const snapshotSlugs = new Set(snapshot.protocols.map((p) => p.slug));
const watchlist = snapshot.watchlist;

/* 1 — dashboard_files */
{
  const dir = join(outDir, 'dashboard');
  const files = readdirSync(dir).filter((n) => statSync(join(dir, n)).isFile()).sort();
  const bytes = files.reduce((a, n) => a + statSync(join(dir, n)).size, 0);
  if (!files.includes('index.html')) fail('dashboard_files', 'no index.html');
  if (!files.some((n) => n.endsWith('.css'))) fail('dashboard_files', 'no .css file');
  if (!files.some((n) => n.endsWith('.js'))) fail('dashboard_files', 'no .js file');
  if (files.length > 400) fail('dashboard_files', `${files.length} files, cap 400`);
  if (bytes > 4 * 1024 * 1024) fail('dashboard_files', `${bytes} bytes, cap 4 MiB`);
  for (const n of files) {
    if (!/^[A-Za-z0-9._-]+$/.test(n) || n.startsWith('.')) fail('dashboard_files', `bad name: ${n}`);
    if (/https?:\/\//.test(readFileSync(join(dir, n), 'utf8'))) fail('dashboard_files', `network address in ${n}`);
  }
  pass('dashboard_files', `${files.length} files, ${bytes} bytes, index + css + js present, no network addresses`);
}

/* 2 — board_file */
let board;
{
  const path = join(outDir, 'board.json');
  const bytes = statSync(path).size;
  if (bytes > 8 * 1024 * 1024) fail('board_file', `${bytes} bytes, cap 8 MiB`);
  board = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(board) || board.length < 100 || board.length > 4000) fail('board_file', `${board.length} rows, must be 100..4000`);
  for (const r of board) {
    if (typeof r.slug !== 'string' || !snapshotSlugs.has(r.slug)) fail('board_file', `slug ${r.slug} is not in the snapshot`);
    if (typeof r.name !== 'string' || r.name.length === 0) fail('board_file', `${r.slug} has no name`);
    if (!Number.isSafeInteger(r.rank) || r.rank <= 0) fail('board_file', `${r.slug} has rank ${r.rank}`);
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) fail('board_file', `${r.slug} has implied value ${r.implied_value_usd}`);
    if (!Array.isArray(r.farm_steps)) fail('board_file', `${r.slug} has no farm_steps array`);
  }
  if (board[0].implied_value_usd === board[board.length - 1].implied_value_usd) fail('board_file', 'all implied values are equal');
  pass('board_file', `${board.length} rows, ${bytes} bytes, every slug in the snapshot, implied values differ`);
}

/* 3 — sorted_by_value */
{
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) fail('sorted_by_value', `rank ${i + 1} is ${ranks[i]}`);
  for (let i = 1; i < board.length; i++) if (board[i].implied_value_usd > board[i - 1].implied_value_usd) fail('sorted_by_value', `row ${i + 1} outranks row ${i}`);
  pass('sorted_by_value', `ranks exactly 1..${board.length}, implied values non-increasing with rank`);
}

/* 4 — coverage */
{
  const slugs = new Set(board.map((r) => r.slug));
  const missing = watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) fail('coverage', `missing watchlist slugs: ${missing.join(', ')}`);
  pass('coverage', `all ${watchlist.length} watchlist slugs present in ${board.length} rows`);
}

/* 5 — farm_steps */
{
  let min = Infinity;
  let max = 0;
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) fail('farm_steps', `${r.slug} has ${r.farm_steps.length} steps`);
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      min = Math.min(min, len);
      max = Math.max(max, len);
      if (len < 20 || len > 600) fail('farm_steps', `${r.slug} has a step of ${len} characters`);
    }
  }
  pass('farm_steps', `every row 3..12 steps, each 20..600 chars (min ${min}, max ${max})`);
}

/* 6 — screenshots */
function pngSize(buf) {
  if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  if (buf.toString('ascii', buf.length - 12 + 4, buf.length - 12 + 8) !== 'IEND') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  if (buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc2) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    const len = buf.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return null;
}
{
  const dir = join(outDir, 'screenshots');
  if (!existsSync(dir)) fail('screenshots', 'no screenshots/ directory');
  const files = readdirSync(dir).filter((n) => !n.startsWith('.') && statSync(join(dir, n)).isFile()).sort();
  if (files.length < 3 || files.length > 4) fail('screenshots', `${files.length} images, must be 3..4`);
  const dims = [];
  for (const n of files) {
    const buf = readFileSync(join(dir, n));
    if (buf.length > 512 * 1024) fail('screenshots', `${n} is ${buf.length} bytes, cap 512 KiB`);
    const size = n.toLowerCase().endsWith('.png') ? pngSize(buf) : jpegSize(buf);
    if (size === null) fail('screenshots', `${n} is not a whole PNG or JPEG`);
    const long = Math.max(size.width, size.height);
    const short = Math.min(size.width, size.height);
    if (long > 1440 || short < 800) fail('screenshots', `${n} is ${size.width}x${size.height}, long side must be <= 1440 and short side >= 800`);
    dims.push(`${n} ${size.width}x${size.height} ${buf.length} bytes`);
  }
  pass('screenshots', `${files.length} images — ${dims.join('; ')}`);
}

/* 7 — dossier_matches */
{
  const path = join(outDir, 'dossier.json');
  const onDisk = readFileSync(path);
  if (onDisk.length > 1_572_864) fail('dossier_matches', `dossier.json is ${onDisk.length} bytes, cap 1.5 MiB`);
  const rebuilt = buildDossier(outDir, { text_max_bytes: 65536 });
  const rebuiltBytes = rebuilt instanceof Uint8Array ? Buffer.from(rebuilt) : Buffer.from(String(rebuilt), 'utf8');
  if (!onDisk.equals(rebuiltBytes)) fail('dossier_matches', 'dossier.json differs from a fresh buildDossier call');
  pass('dossier_matches', `dossier.json is ${onDisk.length} bytes, byte-identical to buildDossier('/output', {text_max_bytes: 65536})`);
}

console.log(`\n${rows}/7 gate rows pass.`);
