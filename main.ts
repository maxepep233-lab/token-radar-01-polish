// The token radar's entry point.
//
// Reads the frozen DefiLlama snapshot, scores every rankable pre-token
// protocol with the calibrated model in lib/model.ts, and writes the build
// the grader reads:
//
//   /output/board.json      the ranked board (rank, slug, name, implied value, farm steps)
//   /output/data.js         window.RADAR, the dashboard's whole dataset
//   /output/dashboard/     the dashboard's source, copied whole
//   /output/screenshots/   the three screenshots, copied whole
//   /output/dossier.json   the dossier, built by the official library
//
// The program is deterministic: it writes the same bytes on every run.
// No clock, no random numbers, no unsorted directory order, no network.
// It refuses to write anything unless the board passes its own validation
// (all 40 watchlist slugs, ranks exactly 1..N, implied values non-increasing
// with rank, farm steps within their bounds), and exits non-zero with a clear
// message when it cannot.
//
//   node main.ts [--input <snapshot.json or its directory>] [--output <dir>]
//
// With no flags it reads /input/snapshot.json and writes /output, the paths
// the grading container provides. MAKEFUN_OUTPUT_DIR also sets the output
// directory, for local runs.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';

const TEXT_MAX_BYTES = 65_536;
const DOSSIER_MAX_BYTES = 1_572_864;

const repoDir = dirname(fileURLToPath(import.meta.url));

/** The value of a --flag, or null when the flag is absent. */
function flagValue(argv: string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  if (i === -1 || i + 1 >= argv.length) return null;
  return argv[i + 1]!;
}

/** The snapshot's path: --input, else /input/snapshot.json, else the repo's own input/. */
function inputPath(argv: string[]): string {
  const given = flagValue(argv, '--input');
  if (given !== null) return resolve(given);
  if (existsSync('/input/snapshot.json')) return '/input/snapshot.json';
  return join(repoDir, 'input', 'snapshot.json');
}

/** The output directory: --output, else MAKEFUN_OUTPUT_DIR, else /output. */
function outputDir(argv: string[]): string {
  const given = flagValue(argv, '--output');
  if (given !== null) return resolve(given);
  const env = process.env.MAKEFUN_OUTPUT_DIR;
  if (env !== undefined && env !== '') return resolve(env);
  return '/output';
}

/** A directory's regular files, in path order: the only order a build may use. */
function plainFiles(dir: string): string[] {
  if (!existsSync(dir)) throw new Error(`missing directory: ${dir}`);
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
}

/** Copy a directory's files into the output, refusing anything unexpected. */
function copyDir(from: string, to: string, label: string): string[] {
  const files = plainFiles(from);
  if (files.length === 0) throw new Error(`${label} is empty: ${from}`);
  mkdirSync(to, { recursive: true });
  for (const name of files) copyFileSync(join(from, name), join(to, name));
  return files;
}

function main(): void {
  const argv = process.argv.slice(2);
  const input = inputPath(argv);
  const out = outputDir(argv);
  if (!existsSync(input)) throw new Error(`snapshot not found: ${input}`);
  const snapshot = parseSnapshot(readFileSync(input, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) throw new Error(`board refused: ${issue}`);
  if (board.length === 0) throw new Error('board refused: no rows');

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  writeFileSync(join(out, 'data.js'), dataScript(radar), 'utf8');
  const dashboardFiles = copyDir(join(repoDir, 'dashboard'), join(out, 'dashboard'), 'dashboard/');
  const screenshotFiles = copyDir(join(repoDir, 'screenshots'), join(out, 'screenshots'), 'screenshots/');
  if (screenshotFiles.length < 3 || screenshotFiles.length > 4) {
    throw new Error(`screenshots/ holds ${screenshotFiles.length} images, the gate takes 3 to 4`);
  }

  const rawDossier: unknown = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES });
  let dossierBytes: Uint8Array;
  if (rawDossier instanceof Uint8Array) dossierBytes = rawDossier;
  else if (typeof rawDossier === 'string') dossierBytes = Buffer.from(rawDossier, 'utf8');
  else throw new Error('buildDossier returned a value that is neither bytes nor text');
  if (dossierBytes.byteLength > DOSSIER_MAX_BYTES) {
    throw new Error(`dossier.json is ${dossierBytes.byteLength} bytes, past the 1.5 MiB cap`);
  }
  writeFileSync(join(out, 'dossier.json'), dossierBytes);

  const top = board[0]!;
  console.log(`board: ${board.length} rows, ${radar.watchlist_size}/${radar.watchlist_size} watchlist, top #1 ${top.slug} $${top.implied_value_usd}`);
  console.log(`dashboard: ${dashboardFiles.length} files, screenshots: ${screenshotFiles.length} files`);
  console.log(`dossier: ${dossierBytes.byteLength} bytes (cap ${DOSSIER_MAX_BYTES})`);
  console.log(`wrote ${out}`);
}

try {
  main();
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
