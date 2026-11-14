// DUSTLINE — a three.js tactical FPS entry for make.fun (Node 22, standard library only).
//
// The game lives in game/ as plain static files: index.html opens in desktop Chrome and
// plays single-player against bots with no build step and no network request, three.js
// 0.187.0 vendored under game/vendor/three/. screenshots/ holds 3–4 real renders of the
// game's own code in a browser; the first by name is the cover.
//
// This program hands the entry in. It copies game/ and screenshots/ from beside this file
// to /output (or $MAKEFUN_OUTPUT_DIR outside the grader) and writes /output/dossier.json,
// the summary the judge reads, with the vendored make.fun library — the same library the
// scorer runs byte for byte on what is handed in, so the dossier it writes here must match
// the one the scorer rebuilds. Before writing it, the program refuses to hand in a game
// the gate would refuse: too many files, too many bytes, a missing index.html, or a
// screenshot over its cap. The copy is a plain recursive copy, so the output is byte-for
// byte deterministic: run it twice into two directories and diff them.
//
// Serve the game locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the dossier's
// bytes; the others refuse an entry the scorer would refuse, so this program checks them
// first and fails loudly instead of handing in a dead entry.
const DOSSIER_TEXT_MAX_BYTES = 163840;
const SCREENSHOT_MAX = 4;
const SCREENSHOT_MAX_BYTES = 262144;
const GAME_MAX_FILES = 993;
const GAME_MAX_BYTES = 50331648;

const here = fileURLToPath(new URL('.', import.meta.url));
const out = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const gameDir = join(here, 'game');
const shotsDir = join(here, 'screenshots');

function fail(message) {
  throw new Error(`dustline: refusing to hand in — ${message}`);
}

function countTree(dir) {
  let files = 0;
  let dirs = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) fail(`game/ holds a symlink: ${path}`);
    if (entry.isDirectory()) {
      dirs += 1;
      const sub = countTree(path);
      files += sub.files;
      dirs += sub.dirs;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += statSync(path).size;
    }
  }
  return { files, dirs, bytes };
}

function checkShots() {
  if (!existsSync(shotsDir)) fail('screenshots/ is missing');
  const shots = readdirSync(shotsDir)
    .filter((name) => /\.(png|jpe?g)$/i.test(name))
    .sort();
  if (shots.length < 3) fail(`screenshots/ holds ${shots.length} images, need 3 or 4`);
  if (shots.length > SCREENSHOT_MAX) fail(`screenshots/ holds ${shots.length} images, at most ${SCREENSHOT_MAX}`);
  for (const name of shots) {
    const size = statSync(join(shotsDir, name)).size;
    if (size > SCREENSHOT_MAX_BYTES) fail(`screenshots/${name} is ${size} bytes, over the ${SCREENSHOT_MAX_BYTES} cap`);
  }
  return shots;
}

function checkGame() {
  if (!existsSync(join(gameDir, 'index.html'))) fail('game/index.html is missing');
  if (statSync(join(gameDir, 'index.html')).size > 1048576) fail('game/index.html is over 1 MiB');
  const totals = countTree(gameDir);
  const entries = totals.files + totals.dirs;
  if (entries > GAME_MAX_FILES) fail(`game/ holds ${entries} files+dirs, over the ${GAME_MAX_FILES} cap`);
  if (totals.bytes > GAME_MAX_BYTES) fail(`game/ is ${totals.bytes} bytes, over the ${GAME_MAX_BYTES} cap`);
  return totals;
}

const shots = checkShots();
const gameTotals = checkGame();

mkdirSync(out, { recursive: true });
cpSync(gameDir, join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: DOSSIER_TEXT_MAX_BYTES,
    screenshots: { max: SCREENSHOT_MAX, max_bytes: SCREENSHOT_MAX_BYTES },
    game_max_files: GAME_MAX_FILES,
    game_max_bytes: GAME_MAX_BYTES,
  }),
);

// The judge reads at most DOSSIER_TEXT_MAX_BYTES of game source; past that cap the
// dossier truncates and the judge never sees the rest of the code. Refuse to hand in
// silently truncated — the fix is to tighten the source, not to hope the cut falls late.
const dossierBytes = statSync(join(out, 'dossier.json')).size;
const dossier = JSON.parse(readFileSync(join(out, 'dossier.json'), 'utf8'));
const dossierTextBytes = Buffer.byteLength(dossier.text ?? '', 'utf8');
if (dossierTextBytes >= DOSSIER_TEXT_MAX_BYTES) {
  fail(`dossier text is ${dossierTextBytes} bytes, at the ${DOSSIER_TEXT_MAX_BYTES} cap — source was truncated`);
}
if (dossierTextBytes > 150000) {
  console.warn(`dustline: warning — dossier text ${dossierTextBytes} bytes, near the ${DOSSIER_TEXT_MAX_BYTES} cap`);
}
console.log(
  `dustline: handed in ${gameTotals.files} game files (${gameTotals.bytes} bytes), ` +
  `${shots.length} screenshots (${shots.join(', ')}), dossier.json ${dossierBytes} bytes -> ${out}`,
);
