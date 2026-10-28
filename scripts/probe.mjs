#!/usr/bin/env node
// The experience probe: a scripted player walks the main journey on a phone and checks the experience targets.
// Usage: node scripts/probe.mjs [--url <url>] [--only 1,4,7] [--json]
// Default target: dist/artifact.html wrapped in the artifact host's skeleton. Writes probe-out/report.json.
// Exit 1 when any target FAILs; SKIP means the DOM hooks it needs aren't rendered yet.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { BLOCK_STORAGE, INSTRUMENT, PHONE, ROOT, contextOptions, launch, resolveTarget, withHash } from './lib/target.mjs';
import { pressMask, solve, toMask } from './lib/solver.mjs';
import {
  BOARD, CELLS, PLAY, Skip, count, debugState, emit, enterLevel, fingers, hasDebug, isVisible, playLevel, readBoard, readNumber, readTiles,
  sheetOpens, tap, tapAction, waitForSolvedSheet, waitInteractive,
} from './lib/play.mjs';

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('Usage: npm run probe [-- --url <url>] [--only 1,4,7]\n  Plays the game like a player on a 390×844 phone and checks the experience targets.\n  Default target: dist/artifact.html in a host-like skeleton. Report: probe-out/report.json');
  process.exit(0);
}
const only = args.only ? new Set(String(args.only).split(',').map(Number)) : null;
// A person taps a few times a second. Back-to-back synthetic taps (< ~250ms apart) wait in headless Chromium's
// input queue for the next frame, which would measure the harness rather than the game.
const PACE = 450;
/** the menu's row for the classic board (each board is a row on home; its levels are on the board screen) */
const CLASSIC_ROW = '[data-room-tile][data-room="classic"]';
const T0 = Date.now();

// ---- targets ----
const TARGETS = {
  1: { name: 'Zero network', target: '0 requests' },
  2: { name: 'Playable fast', target: 'lo:interactive ≤ 800ms' },
  3: { name: 'Console errors', target: '0' },
  4: { name: 'First win', target: 'solved sheet ≤ 10s from load' },
  5: { name: 'Tap response', target: 'p95 tap ≤ 8ms, →frame ≤ 25ms; win ≤ 16ms' },
  6: { name: 'Smooth sweep', target: '≥ 55fps for 800ms after win' },
  7: { name: 'Every level', target: '50 levels, par = min, 3★ each' },
  8: { name: 'Hint flow', target: 'hint shows, clears, ≤ 2★' },
  9: { name: 'Undo / restart', target: 'undo restores, restart → 0' },
  10: { name: 'Progress survives reload', target: 'same tile stars' },
  11: { name: 'Blocked storage', target: 'plays + storage notice' },
  12: { name: 'Layout', target: '6 viewports: no h-scroll, 44px, board fits' },  // board slots: 44px, or the board aims
  13: { name: 'Page weight', target: '≤ 310KB, gzip ≤ 112KB' },
  14: { name: 'Offline install (PWA)', target: 'plays offline after SW ready' },
  15: { name: 'Every room by touch', target: 'level 1 of each; slot ≥ 40px or aim (hex ≥ 36 at 320; cube: front face)' },
};
const VIEWPORTS = [
  { width: 320, height: 568 }, { width: 375, height: 667 }, { width: 390, height: 844 },
  { width: 768, height: 1024 }, { width: 1440, height: 900 }, { width: 812, height: 375, name: 'landscape' },
];
const results = {};
const extra = {};
function record(id, status, measured, detail = '') { results[id] = { id, ...TARGETS[id], status, measured, detail }; }
async function check(id, fn) {
  if (only && !only.has(id)) return record(id, 'SKIP', '—', 'not selected (--only)');
  try {
    const r = await fn();
    record(id, r.pass ? 'PASS' : 'FAIL', r.measured, r.detail ?? '');
  } catch (err) {
    if (err instanceof Skip) record(id, 'SKIP', '—', err.message);
    else record(id, 'FAIL', '—', firstLine(err));
  }
  return results[id];
}
const blockedBy = (id, dep) => record(id, 'SKIP', '—', `needs #${dep} (${results[dep]?.status ?? 'not run'}: ${results[dep]?.detail || TARGETS[dep].name})`);

// ---- browser plumbing ----
let target;
try { target = resolveTarget(args.url); } catch (err) { console.error(err.message); process.exit(2); }
const pageUrl = target.url.split('#')[0];
// classic pars from the data: bands of ten, each band's nine levels then its boss (DECISIONS #46)
const rulesPars = JSON.parse(readFileSync(join(ROOT, 'data/rules.json'), 'utf8')).levels.bands.flatMap((b) => [...b.pars, b.boss]);
const browser = await launch();
const requests = [];
const errors = [];

async function newPage(label, size = PHONE, { network = true, init = [] } = {}) {
  const context = await browser.newContext(contextOptions(size));
  await context.addInitScript(INSTRUMENT);
  for (const s of init) await context.addInitScript(s);
  if (network) {
    context.on('request', (req) => {
      const u = req.url();
      if (u.startsWith('data:') || u.startsWith('blob:') || u.split('#')[0] === pageUrl) return;
      requests.push({ where: label, url: u.slice(0, 120) });
    });
  }
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push({ where: label, text: firstLine(e) }));
  page.on('console', (m) => { if (m.type() === 'error') errors.push({ where: label, text: m.text().slice(0, 200) }); });
  return { context, page };
}

async function open(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  return waitInteractive(page);
}

// ---- phase A: the first-run journey on a phone, alone on the CPU so timings mean something ----
const main = await newPage('journey');
let interactive = null;
await check(2, async () => {
  interactive = await open(main.page, target.url);
  if (interactive === null) return { pass: false, measured: 'no mark', detail: "performance mark 'lo:interactive' never appeared" };
  return { pass: interactive <= 800, measured: `${Math.round(interactive)}ms` };
});
if (interactive === null && results[2].status !== 'FAIL') await open(main.page, target.url);

// The 50-level playthrough is mostly waiting on the win sweep; start it now so the run fits in 90s.
const everyLevelDone = check(7, everyLevel);

let journeyOk = false;
await check(4, async () => {
  await tapAction(main.page, 'continue');
  const start = await enterLevel(main.page);
  const par = await readNumber(main.page, '[data-par]');
  const { taps } = await playLevel(main.page, { pointer: 'follow', armSweep: true, pace: PACE });
  const sheet = await waitForSolvedSheet(main.page);
  const shownAt = sheet.at;
  journeyOk = true;
  extra.firstWin = { level: start.level, taps, par, stars: sheet.stars, ms: Math.round(shownAt) };
  return {
    pass: shownAt <= 10000,
    measured: `${(shownAt / 1000).toFixed(1)}s, ${taps} taps (par ${par ?? '?'})`,
    detail: `level ${start.level ?? '?'}, ${sheet.stars ?? '?'}★`,
  };
});

// Keep playing (Next) until at least 20 taps are measured, so tap response and sweeps have samples.
let playedInJourney = 1;
if (journeyOk) {
  try {
    while ((await main.page.evaluate(() => window.__probe.taps.length)) < 20 && playedInJourney < 12) {
      const after = await sheetOpens(main.page);
      await tapAction(main.page, 'next');
      await enterLevel(main.page);
      await playLevel(main.page, { pointer: 'if-optimal', armSweep: true, pace: PACE });
      await waitForSolvedSheet(main.page, { after });
      playedInJourney++;
    }
  } catch (err) {
    extra.journeyStop = firstLine(err);
  }
}

if (!journeyOk) blockedBy(5, 4);
else await check(5, async () => {
  const taps = (await main.page.evaluate(() => window.__probe.taps)).filter((t) => t.dom !== null && t.frame !== null);
  if (taps.length < 20) return { pass: false, measured: `${taps.length} taps`, detail: `only ${taps.length} taps changed data-lit (${extra.journeyStop ?? 'need ≥ 20'})` };
  // Ordinary taps carry the target; a winning tap also starts the sweep, saves progress and schedules the sheet,
  // so it gets its own, looser bound (the light still changes in that same handler).
  const plain = taps.filter((t) => !t.win);
  const wins = taps.filter((t) => t.win);
  const handler = p95(plain.map((t) => t.dom - t.entry));
  const handlerFrame = p95(plain.map((t) => t.frame - t.entry));
  const winMax = wins.length ? Math.max(...wins.map((t) => t.dom - t.entry)) : 0;
  const dom = p95(taps.map((t) => t.dom - t.down));
  const frame = p95(taps.map((t) => t.frame - t.down));
  extra.tapResponse = { samples: taps.length, wins: wins.length, paceMs: PACE, handlerP95: round1(handler), handlerFrameP95: round1(handlerFrame), winHandlerMax: round1(winMax), domP95: round1(dom), frameP95: round1(frame) };
  // Judged from the game's first pointerdown listener: headless Chromium adds ~15-20ms of its own
  // touch-delivery delay before any page code runs, which no page can change (DECISIONS #22).
  return {
    pass: handler <= 8 && handlerFrame <= 25 && winMax <= 16,
    measured: `tap ${round1(handler)}ms, →frame ${round1(handlerFrame)}ms, win ≤${round1(winMax)}ms (n=${plain.length}+${wins.length})`,
    detail: `from the touch's timestamp: DOM ${round1(dom)}ms, frame ${round1(frame)}ms (includes the rig's touch delivery)`,
  };
});

if (!journeyOk) blockedBy(6, 4);
else await check(6, async () => {
  const sweeps = await main.page.evaluate(() => window.__probe.sweeps);
  if (!sweeps.length) return { pass: false, measured: '—', detail: 'no sweep measured' };
  const fps = sweeps.map((s) => (s.frames * 1000) / s.ms);
  const avg = fps.reduce((a, b) => a + b, 0) / fps.length;
  return { pass: avg >= 55, measured: `${round1(avg)}fps avg, worst ${round1(Math.min(...fps))} (${sweeps.length} wins)` };
});

// ---- phase B: functional checks, in parallel with the 50-level playthrough ----
await Promise.all([
  (async () => {
    // B1: same player keeps going: reload, hint, undo/restart
    if (!journeyOk) { blockedBy(10, 4); blockedBy(8, 4); blockedBy(9, 4); return; }
    await check(10, () => progressSurvivesReload(main.page));
    await check(8, () => hintFlow(main.page));
    await check(9, () => undoRestart(main.page));
  })(),
  everyLevelDone,
  (async () => {
    await check(11, blockedStorage);
    await check(12, layout);
    await check(14, offlineInstall);
    await check(15, varietyRooms);
  })(),
]);

await check(1, async () => {
  const list = [...new Set(requests.map((r) => `${r.url} (${r.where})`))];
  return { pass: requests.length === 0, measured: String(requests.length), detail: list.slice(0, 3).join('; ') + (list.length > 3 ? ` …+${list.length - 3}` : '') };
});
await check(3, async () => {
  const list = [...new Set(errors.map((e) => `[${e.where}] ${e.text}`))];
  return { pass: errors.length === 0, measured: String(errors.length), detail: list.slice(0, 3).join('; ') + (list.length > 3 ? ` …+${list.length - 3}` : '') };
});
await check(13, async () => {
  if (!target.file || !existsSync(target.file)) throw new Skip('target is not a local file');
  const bytes = statSync(target.file).size;
  const gz = gzipSync(readFileSync(target.file)).length;
  return { pass: bytes <= 310 * 1024 && gz <= 112 * 1024, measured: `${kb(bytes)} (gzip ${kb(gz)})`, detail: target.file.replace(ROOT + '/', '') };
});

await browser.close();
target.cleanup();
report();

// =====================================================================================
// checks

async function progressSurvivesReload(page) {
  if ((await count(page, '[data-room-tile]')) === 0) throw new Skip('home board rows not rendered yet ([data-room-tile])');
  // to the classic board's levels as the player would (the solved sheet's Levels, or the menu's Classic row),
  // then compare the tiles before and after a reload, reaching them again through the menu
  if (await isVisible(page, '[data-action="levels"]')) await tapAction(page, 'levels');
  else {
    if (await isVisible(page, '[data-action="back"]')) await tapAction(page, 'back');
    await tapAction(page, CLASSIC_ROW);
  }
  await boardShows(page, 'classic');
  const before = await readTiles(page);
  const starred = Object.values(before).filter((s) => Number(s) > 0).length;
  if (starred === 0) return { pass: false, measured: '0 tiles with stars', detail: `solved ${playedInJourney} levels but no tile shows data-stars > 0` };
  await page.reload({ waitUntil: 'load' });
  await waitInteractive(page);
  await tapAction(page, CLASSIC_ROW);
  await boardShows(page, 'classic');
  const after = await readTiles(page);
  // back to the menu, where the next check starts
  await tapAction(page, 'variety-back');
  await page.locator('[data-action="continue"] >> visible=true').first().waitFor({ timeout: 3000 });
  const diff = Object.keys(before).filter((k) => before[k] !== after[k]);
  return {
    pass: diff.length === 0,
    measured: `${starred} starred tiles, ${diff.length} changed`,
    detail: diff.slice(0, 4).map((k) => `level ${k}: ${before[k]}→${after[k]}`).join(', '),
  };
}

async function hintFlow(page) {
  if ((await count(page, '[data-action="hint"]')) === 0) throw new Skip('[data-action="hint"] not rendered yet');
  await tapAction(page, 'continue');
  let b = await enterLevel(page);
  const level = b.level;
  const after = await sheetOpens(page);
  await tapAction(page, 'hint');
  const shown = await page.waitForFunction((CELLS) => document.querySelector(`${CELLS}[data-hint="true"]`), CELLS, { timeout: 2000 }).then(() => true, () => false);
  if (!shown) return { pass: false, measured: 'no hint', detail: 'no [data-hint="true"] cell within 2s of tapping Hint' };
  b = await readBoard(page);
  const hinted = b.hint;
  // a correct hint is on SOME fewest-moves solution: pressing it brings the minimum down by one
  const onSolution = (solve(b.lit ^ pressMask(hinted))?.length ?? 99) === (solve(b.lit)?.length ?? 0) - 1;
  b = await tap(page, b, hinted);
  const cleared = (await count(page, `${CELLS}[data-hint="true"]`)) === 0;
  await playLevel(page, { pointer: 'if-optimal', board: b });
  const sheet = await waitForSolvedSheet(page, { after });
  const problems = [];
  if (!cleared) problems.push('hint mark stayed after tapping the hinted cell');
  if (!onSolution) problems.push(`hinted cell ${hinted} is not on a fewest-moves solution`);
  if (!(sheet.stars <= 2)) problems.push(`solved with ${sheet.stars}★ after a hint`);
  return { pass: problems.length === 0, measured: `level ${level ?? '?'}: cell ${hinted}, ${sheet.stars ?? '?'}★`, detail: problems.join('; ') };
}

async function undoRestart(page) {
  for (const a of ['undo', 'restart']) if ((await count(page, `[data-action="${a}"]`)) === 0) throw new Skip(`[data-action="${a}"] not rendered yet`);
  await tapAction(page, 'next');
  const start = await enterLevel(page);
  const problems = [];
  const [first, second] = solve(start.lit);
  let b = await tap(page, start, first);
  if (b.moves !== 1) problems.push(`moves ${b.moves} after one tap`);
  await tapAction(page, 'undo');
  b = await readBoard(page, b.lit);
  if (b.lit !== start.lit) problems.push('undo did not restore the lights');
  if (b.moves !== start.moves) problems.push(`undo left moves at ${b.moves}`);
  b = await tap(page, b, first);
  b = await tap(page, b, second ?? first);
  await tapAction(page, 'restart');
  b = await readBoard(page, b.lit);
  if (b.moves !== 0) problems.push(`restart left moves at ${b.moves}`);
  if (b.lit !== start.lit) problems.push('restart did not restore the start board');
  return { pass: problems.length === 0, measured: problems.length ? `${problems.length} problem(s)` : 'ok', detail: problems.join('; ') };
}

async function everyLevel() {
  const { context, page } = await newPage('every-level');
  try {
    await open(page, withHash(target.url, 'debug'));
    if (!(await hasDebug(page))) throw new Skip('window.__lightsOut.debug missing with #debug');
    await page.waitForFunction(() => window.__lightsOut.debug.state().levels?.status === 'ready', null, { timeout: 10000 })
      .catch(() => { throw new Skip('levels slice never became ready'); });
    // the classic path only; Variety rooms are checked by target 15
    const list = (await debugState(page)).levels.list.filter((l) => !l.pack || l.pack === 'classic');
    const problems = [];
    if (list.length !== 50) problems.push(`${list.length} levels, expected 50`);
    list.forEach((l, k) => {
      const s = solve(l.cells);
      if (!s) problems.push(`level ${l.id} unsolvable`);
      else if (s.length !== l.par) problems.push(`level ${l.id}: par ${l.par} but min ${s.length}`);
      if (rulesPars[k] !== undefined && l.par !== rulesPars[k]) problems.push(`level ${l.id}: par ${l.par} ≠ rules.json ${rulesPars[k]}`);
    });
    const masks = list.map((l) => toMask(l.cells));
    if (new Set(masks).size !== masks.length) problems.push('duplicate boards');
    if (problems.length) return { pass: false, measured: `${list.length} levels`, detail: problems.slice(0, 4).join('; ') };

    // play them all, like a player: Continue, then Next after each win
    const t0 = Date.now();
    let solved = 0;
    if ((await count(page, '[data-sheet="solved"]')) === 0) {
      throw new Skip(`board data ok (50 levels, par = solver minimum = rules.json); play-through needs the solved sheet`);
    }
    // tap Continue like a player; until the home view exists, start level 1 through the debug bus
    let viaDebug = false;
    if ((await count(page, '[data-action="continue"]')) > 0) await tapAction(page, 'continue');
    else { viaDebug = true; await emit(page, 'levels:start', { levelId: 1 }); }
    for (let n = 1; n <= list.length; n++) {
      const b = await enterLevel(page);
      if (b.lit !== masks[n - 1]) { problems.push(`expected level ${n} on screen, got ${b.level ? `level ${b.level}` : 'another board'}`); break; }
      const after = await sheetOpens(page);
      const { taps } = await playLevel(page, { pointer: 'if-optimal' });
      const sheet = await waitForSolvedSheet(page, { after, allowComplete: n === list.length });
      if (sheet.sheet === 'solved' && sheet.stars !== 3) problems.push(`level ${n}: ${sheet.stars}★ in ${taps} taps (par ${list[n - 1].par})`);
      solved++;
      if (n < list.length) {
        if (!viaDebug && (await count(page, '[data-action="next"]')) > 0) await tapAction(page, 'next');
        else { viaDebug = true; await emit(page, 'levels:start', { levelId: n + 1 }); }
      }
      if (problems.length > 3) break;
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    extra.everyLevel = { solved, seconds: Number(secs) };
    if (viaDebug) problems.push('(levels started via debug levels:start: no Continue/Next buttons yet)');
    const real = problems.filter((p) => !p.startsWith('('));
    return { pass: real.length === 0 && solved === 50, measured: `${solved}/50 played in ${secs}s`, detail: problems.slice(0, 4).join('; ') };
  } finally {
    await context.close();
  }
}

async function blockedStorage() {
  const { context, page } = await newPage('blocked-storage', PHONE, { init: [BLOCK_STORAGE] });
  try {
    await open(page, target.url);
    // the warning belongs on the home screen, where the player starts (it is hidden during play: DECISIONS #39)
    const onHome = (await count(page, '[data-notice="storage"]')) > 0 && (await isVisible(page, '[data-notice="storage"]'));
    await tapAction(page, 'continue');
    await enterLevel(page);
    await playLevel(page, { pointer: 'follow' });
    await waitForSolvedSheet(page);
    if ((await count(page, '[data-notice="storage"]')) === 0) return { pass: false, measured: 'played, no notice', detail: 'no [data-notice="storage"] when localStorage throws' };
    return { pass: onHome, measured: onHome ? 'played; notice shown on home' : 'played; notice not visible on home' };
  } finally {
    await context.close();
  }
}


async function layout() {
  const per = await Promise.all(VIEWPORTS.map(layoutAt));
  const skipped = per.filter((p) => p.skip);
  if (skipped.length === per.length) throw new Skip(skipped[0].skip);
  const bad = per.filter((p) => p.problems.length);
  extra.layout = per;
  return {
    pass: bad.length === 0 && skipped.length === 0,
    measured: `${per.length - bad.length - skipped.length}/${per.length} ok`,
    detail: [...bad.map((p) => `${p.size}: ${p.problems.slice(0, 2).join(', ')}`), ...skipped.map((p) => `${p.size}: ${p.skip}`)].join(' | '),
  };
}

async function layoutAt(size) {
  const label = `${size.width}×${size.height}`;
  const { context, page } = await newPage(`layout ${label}`, size);
  const problems = [];
  const inspect = async (where) => {
    const r = await page.evaluate(() => {
      scrollTo(0, 0);
      const shown = (el) => !el.closest('[hidden]') && el.getClientRects().length > 0;
      // a board cell's touch target is its grid slot: the gutter between cells presses the nearest cell (DECISIONS #40);
      // a board in aim mode (press-and-hold, magnifier, lift to press) is exempt: that is its answer to small slots
      const slotOf = (el) => {
        const bd = el.closest('[data-board]');
        if (!bd) return null;
        if (bd.dataset.aim === 'true') return { w: 44, h: 44 };
        const r = bd.getBoundingClientRect();
        const h = bd.dataset.scroll === 'true' ? bd.scrollHeight : r.height;
        return { w: r.width / (Number(bd.dataset.cols) || 5), h: h / (Number(bd.dataset.rows) || 5) };
      };
      const small = [...document.querySelectorAll('[data-cell], [data-action], [data-room-tile], [data-level-tile]')].filter(shown).map((el) => {
        const r = el.matches('[data-cell]') ? (slotOf(el) ?? el.getBoundingClientRect()) : el.getBoundingClientRect();
        const what = el.dataset.action ?? (el.dataset.room ? `row ${el.dataset.room}` : el.dataset.level ? `tile ${el.dataset.level}` : 'cell');
        return { what, w: r.width, h: r.height };
      }).filter((s) => s.w < 43.5 || s.h < 43.5);
      const board = document.querySelector('[data-screen="play"] [data-board]');
      const b = board && shown(board) ? board.getBoundingClientRect() : null;
      return {
        sw: document.documentElement.scrollWidth, iw: innerWidth,
        small, board: b && { top: b.top, bottom: b.bottom, left: b.left, right: b.right, ih: innerHeight, iw: innerWidth },
      };
    });
    if (r.sw > r.iw) problems.push(`${where}: h-scroll ${r.sw}>${r.iw}`);
    const names = [...new Set(r.small.map((s) => `${s.what} ${Math.round(s.w)}×${Math.round(s.h)}`))];
    if (names.length) problems.push(`${where}: small ${names.slice(0, 3).join(', ')}`);
    return r;
  };
  try {
    await open(page, target.url);
    await inspect('home');
    // the classic board's level screen, reached from its menu row
    try { await tapAction(page, CLASSIC_ROW); } catch (err) { if (err instanceof Skip) return { size: label, skip: err.message, problems }; throw err; }
    await boardShows(page, 'classic');
    await inspect('board');
    await tapAction(page, 'variety-back');
    try { await tapAction(page, 'continue'); } catch (err) { if (err instanceof Skip) return { size: label, skip: err.message, problems }; throw err; }
    await enterLevel(page);
    const r = await inspect('play');
    if (!r.board) problems.push('play: board not visible');
    else if (r.board.top < -0.5 || r.board.bottom > r.board.ih + 0.5 || r.board.left < -0.5 || r.board.right > r.board.iw + 0.5) {
      problems.push(`play: board ${Math.round(r.board.top)}–${Math.round(r.board.bottom)} outside 0–${r.board.ih}`);
    }
    await playLevel(page, { pointer: 'follow' });
    await waitForSolvedSheet(page);
    await page.waitForTimeout(350);
    await inspect('solved');
  } catch (err) {
    if (err instanceof Skip) return { size: label, skip: err.message, problems };
    problems.push(firstLine(err));
  } finally {
    await context.close();
  }
  return { size: label, problems };
}

async function offlineInstall() {
  const dir = join(ROOT, 'dist-pwa');
  if (!existsSync(join(dir, 'index.html'))) throw new Skip('dist-pwa/ not built (npm run build:pwa)');
  const server = await serve(dir);
  const { context, page } = await newPage('pwa', PHONE, { network: false });
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    await open(page, url);
    const ready = await page.evaluate(() => Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise((r) => setTimeout(() => r(false), 10000)),
    ]));
    if (!ready) return { pass: false, measured: 'no worker', detail: 'navigator.serviceWorker.ready did not resolve in 10s' };
    await context.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    await waitInteractive(page);
    await tapAction(page, 'continue');
    await enterLevel(page);
    await playLevel(page, { pointer: 'follow' });
    await waitForSolvedSheet(page);
    return { pass: true, measured: 'level 1 solved offline' };
  } finally {
    await context.close();
    server.close();
  }
}

// =====================================================================================
// helpers

function serve(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain' };
  const server = createServer((req, res) => {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    if (p.endsWith('/')) p += 'index.html';
    const file = join(dir, p);
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

function report() {
  const rows = Object.keys(TARGETS).map(Number).map((id) => results[id] ?? { id, ...TARGETS[id], status: 'SKIP', measured: '—', detail: 'not run' });
  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  const mark = { PASS: 'PASS', FAIL: 'FAIL', SKIP: 'SKIP' };
  console.log(`\nprobe: ${args.url ?? 'dist/artifact.html (host skeleton)'}\n`);
  console.log(`${w('#', 3)}${w('target', 26)}${w('goal', 34)}${w('measured', 38)}result`);
  console.log('-'.repeat(107));
  for (const r of rows) {
    console.log(`${w(r.id, 3)}${w(r.name, 26)}${w(r.target, 34)}${w(r.measured, 38)}${mark[r.status]}`);
    if (r.detail && r.status !== 'PASS') console.log(`${' '.repeat(29)}↳ ${r.detail}`);
  }
  const failed = rows.filter((r) => r.status === 'FAIL').length;
  const skipped = rows.filter((r) => r.status === 'SKIP').length;
  const secs = ((Date.now() - T0) / 1000).toFixed(1);
  console.log(`\n${rows.length - failed - skipped} pass, ${failed} fail, ${skipped} skip in ${secs}s → probe-out/report.json`);
  mkdirSync(join(ROOT, 'probe-out'), { recursive: true });
  writeFileSync(join(ROOT, 'probe-out/report.json'), JSON.stringify({
    target: args.url ?? 'dist/artifact.html', at: new Date().toISOString(), seconds: Number(secs),
    results: rows, extra, requests, errors,
  }, null, 2));
  process.exit(failed ? 1 : 0);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
    }
  }
  return out;
}
/** waits until a board's level screen ([data-room-view]) is showing; SKIP when the board screen isn't rendered at all */
async function boardShows(page, id, timeout = 3000) {
  const sel = `[data-screen="variety"] [data-room-view="${id}"]`;
  try {
    await page.locator(`${sel} >> visible=true`).first().waitFor({ timeout });
  } catch (err) {
    if ((await count(page, '[data-screen="variety"]')) === 0) throw new Skip('board screen not rendered yet ([data-screen="variety"])');
    throw new Error(`board "${id}" didn't show (${sel})`);
  }
}
function p95(xs) { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; }
function round1(x) { return Math.round(x * 10) / 10; }
function kb(n) { return `${(n / 1024).toFixed(1)}KB`; }
function firstLine(err) { return String(err?.message ?? err).split('\n')[0].slice(0, 200); }


/**
 * Every room (every board but classic): its first level plays by touch, gaps are never buttons, and each touch slot
 * is ≥ 44px or the board is in aim mode. At 390 the level is played to the end by real taps (aim boards press on
 * release, so a tap is down and up at one point; the Tower scrolls each cell into view first), and a swipe on the
 * Tower must scroll it without pressing anything.
 */
async function varietyRooms() {
  const out = [];
  const seen = new Set();
  const modes = {};
  for (const size of [{ width: 390, height: 844 }, { width: 375, height: 667 }, { width: 320, height: 568 }]) {
    const { context, page } = await newPage(`variety-${size.width}`, size);
    try {
      await open(page, withHash(target.url, 'debug'));
      if (!(await hasDebug(page))) throw new Skip('window.__lightsOut.debug missing with #debug');
      const packs = (await debugState(page)).levels.packs?.filter((p) => p.id !== 'classic') ?? [];
      if (!packs.length) throw new Skip('no Variety rooms in the levels slice');
      await page.evaluate(() => window.__lightsOut.debug.commands()['progress.unlock'](['20']));
      for (const pack of packs) {
        seen.add(pack.id);
        // like a player: the room's row on the menu, then its first level on the board screen
        await tapAction(page, `[data-room-tile][data-room="${pack.id}"]`);
        await boardShows(page, pack.id);
        await tapAction(page, `[data-level-tile][data-level="${pack.first}"]`);
        await page.waitForFunction((id) => window.__lightsOut.debug.state().board?.levelId === id, pack.first, { timeout: 3000 });
        await page.waitForTimeout(250);
        const info = await page.evaluate((PLAY) => {
          const b = window.__lightsOut.debug.state().board;
          const shape = b.shape ?? { cols: 5, rows: 5, mask: null };
          const real = shape.mask ? shape.mask.filter(Boolean).length : shape.cols * shape.rows;
          const cells = [...document.querySelectorAll(`${PLAY} [data-cell]`)];
          const gapButtons = [...document.querySelectorAll(`${PLAY} [data-gap]`)].filter((g) => g.matches('button, [data-cell], [tabindex]:not([tabindex="-1"])')).length;
          const bd = document.querySelector(`${PLAY} [data-board]`);
          const r = bd.getBoundingClientRect();
          const scroll = bd.dataset.scroll === 'true';
          const grid = bd.dataset.grid ?? 'square';
          const css = getComputedStyle(bd);
          // the touch slot: board size / cols, gutter included (DECISIONS #40); a scrolling board's whole height;
          // a honeycomb's pitch (a tap between lights goes to the nearest); a cube's lights on the face toward you
          const front = [...document.querySelectorAll(`${PLAY} .cube__face[data-face="front"] [data-cell]`)].map((c) => c.getBoundingClientRect());
          const slot = grid === 'hex' ? (r.width - 2 * (parseFloat(css.paddingLeft) || 0)) / (shape.cols + 0.5)
            : grid === 'cube' ? Math.min(...front.map((c) => Math.min(c.width, c.height)))
            : Math.min(r.width / shape.cols, (scroll ? bd.scrollHeight : r.height) / shape.rows);
          const sol = window.__lightsOut.kernel.service('solver').solve(b.cells, b.shape);
          return { real, cells: cells.length, gapButtons, slot, aim: bd.dataset.aim === 'true', scroll, top: bd.scrollTop, sol, par: b.par, grid };
        }, PLAY);
        const where = `${pack.id}@${size.width}`;
        (modes[size.width] ??= []).push(`${pack.id} ${Math.round(info.slot)}px${info.aim ? ' aim' : info.scroll ? ' scroll' : info.grid !== 'square' ? ` ${info.grid}` : ''}`);
        if (info.cells !== info.real) out.push(`${where}: ${info.cells} cells shown, ${info.real} expected`);
        if (info.gapButtons) out.push(`${where}: ${info.gapButtons} gaps are tappable`);
        // instant boards need 40px slots or more (DECISIONS #40: the whole slot is the target); smaller slots aim (#48)
        // a honeycomb can't reach 40 on a 320 phone (seven lights and a half across); its gaps count, so 36 there (DECISIONS)
        const need = info.grid === 'hex' && size.width < 375 ? 36 : 40;
        if (info.slot < need - 0.5 && !info.aim) out.push(`${where}: touch slot ${info.slot.toFixed(0)}px < ${need}px and not in aim mode`);
        if (info.slot >= 40.5 && info.aim) out.push(`${where}: aim mode on ${info.slot.toFixed(0)}px slots`);
        if (info.scroll && info.top !== 0) out.push(`${where}: the Tower did not start at the top (scrollTop ${info.top})`);
        if (size.width === 390) {
          if (info.scroll) {
            // a swipe scrolls the Tower and presses nothing
            const box = await page.locator(`${PLAY} [data-cell]`).nth(12).boundingBox();
            const finger = await fingers(page);
            await finger.swipe(box.x + box.width / 2, box.y + box.height / 2, 0, -220);
            await finger.detach();
            await page.waitForTimeout(300);
            const after = await page.evaluate((PLAY) => ({ moves: window.__lightsOut.debug.state().board.moves, top: document.querySelector(`${PLAY} [data-board]`).scrollTop }), PLAY);
            if (after.moves !== 0) out.push(`${pack.id}: a swipe pressed ${after.moves} cell(s)`);
            if (!(after.top > 0)) out.push(`${pack.id}: a swipe did not scroll the board`);
            extra.towerSwipe = { scrolled: after.top, moves: after.moves };
          }
          if (info.grid === 'cube') {
            // a swipe turns the cube and presses nothing
            const bb = await page.locator(`${PLAY} [data-board]`).boundingBox();
            const before = await page.evaluate((PLAY) => [...document.querySelectorAll(`${PLAY} .cube__face[data-facing]`)].map((f) => f.dataset.face).sort().join(), PLAY);
            const finger = await fingers(page);
            await finger.swipe(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2, -140, 0);
            await finger.detach();
            await page.waitForTimeout(550);
            const after = await page.evaluate((PLAY) => ({ moves: window.__lightsOut.debug.state().board.moves, faces: [...document.querySelectorAll(`${PLAY} .cube__face[data-facing]`)].map((f) => f.dataset.face).sort().join() }), PLAY);
            if (after.moves !== 0) out.push(`${pack.id}: a swipe pressed ${after.moves} light(s)`);
            if (after.faces === before) out.push(`${pack.id}: a swipe did not turn the cube`);
            extra.cubeSwipe = { before, after: after.faces, moves: after.moves };
          }
          const opened = await sheetOpens(page);
          for (const i of info.sol) {
            const loc = page.locator(`${PLAY} [data-cell][data-index="${i}"]`);
            if (!(await loc.count())) { out.push(`${pack.id}: cell ${i} missing`); break; }
            if (info.scroll) await loc.first().evaluate((el) => el.scrollIntoView({ block: 'nearest' }));
            if (info.grid === 'cube') {
              // like a player: turn the cube until the light's face is in view
              const turned = await page.evaluate((i) => {
                const face = document.querySelector(`[data-cell][data-index="${i}"]`).closest('.cube__face');
                if (face.dataset.facing) return false;
                window.__lightsOut.debug.commands()['play-view.show']([String(i)]);
                return true;
              }, i);
              if (turned) await page.waitForTimeout(500);
            }
            const box = await loc.first().boundingBox({ timeout: 1000 });
            if (!box || box.y < 0 || box.y + box.height > size.height) { out.push(`${pack.id}: cell ${i} not on screen`); break; }
            await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
            await page.waitForTimeout(60);
          }
          const moves = await page.evaluate(() => window.__lightsOut.debug.state().board.moves);
          if (moves !== info.sol.length) out.push(`${pack.id}: ${info.sol.length} taps made ${moves} moves`);
          const sheet = await waitForSolvedSheet(page, { after: opened }).catch(() => null);
          if (!sheet) out.push(`${pack.id}: solved sheet didn't open after ${info.sol.length} taps (par ${info.par})`);
          else {
            if (sheet.stars !== 3) out.push(`${pack.id}: ${sheet.stars}★ at par`);
            // the sheet's Levels returns to this room's board screen; its back goes to the menu
            await tapAction(page, 'levels');
            if (!(await boardShows(page, pack.id).then(() => true, () => false))) out.push(`${pack.id}: Levels didn't return to its board`);
            await tapAction(page, 'variety-back');
          }
          if (!(await isVisible(page, '[data-action="continue"]'))) { await emit(page, 'nav:close_sheet', {}); await emit(page, 'nav:go', { screen: 'home' }); }
        } else {
          // Back from a level returns to the board it was opened from, and the board's Back to the menu
          await tapAction(page, 'back');
          if (!(await boardShows(page, pack.id).then(() => true, () => false))) out.push(`${where}: Back from the level didn't return to its board`);
          await tapAction(page, 'variety-back');
        }
      }
    } finally {
      await context.close();
    }
  }
  extra.rooms = modes;
  return { pass: out.length === 0, measured: out.length ? `${out.length} problems` : `${seen.size} rooms × 3 sizes ok`, detail: out.slice(0, 4).join('; ') };
}
