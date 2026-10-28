#!/usr/bin/env node
// Look at your work: screenshots of one game state at several widths.
// Reaches the state through window.__lightsOut.debug.emit (needs #debug), then waits for transitions to finish.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { INSTRUMENT, ROOT, contextOptions, launch, resolveTarget, withHash } from './lib/target.mjs';
import { solve } from './lib/solver.mjs';
import { CELLS, PLAY, Skip, debugState, emit, enterLevel, fingers, hasDebug, readBoard, settle, sheetOpens, tap, waitForSolvedSheet, waitInteractive } from './lib/play.mjs';

const USAGE = `Usage: npm run look -- --state <state> [options]

States:
  home        the home screen (the menu of boards)
  board:ID    one board's level screen, e.g. board:classic, board:ring (rooms open after classic level 20: add --solved 20)
  play:N      level N, untouched (any board: room levels open the rooms first, e.g. play:9001)
  hint:N      level N with a hint showing
  aim:N       level N with a finger held on a cell (the aim bubble on boards in aim mode)
  solved:N    level N solved, solved sheet open (classic levels)
  console     the debug console over the home screen

Options:
  --solved N              first mark classic levels 1..N solved at 3★ (progress.unlock), e.g. to show the rooms open
  --widths 375,768,1440   widths to shoot (height: 844 below 768, 1024 at 768–1199, 900 from 1200)
  --sizes 320x568,390x844 exact viewports to shoot instead of --widths
  --landscape             also shoot a 812×375 phone on its side
  --short                 also shoot a short 375×600 phone
  --out look-out          output folder
  --url <url>             page to load (default: dist/artifact.html in the host skeleton)
  --help                  this text`;

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.state) { console.log(USAGE); process.exit(args.help ? 0 : 2); }
const m = String(args.state).match(/^(home|console|play|hint|aim|solved|board)(?::([\w-]+))?$/);
const needsNum = ['play', 'hint', 'aim', 'solved'].includes(m?.[1]);
if (!m || (needsNum && !/^\d+$/.test(m[2] ?? '')) || (m[1] === 'board' && !m[2])) { console.error(`Unknown state "${args.state}".\n\n${USAGE}`); process.exit(2); }
const [, kind, arg] = m;
const level = needsNum ? Number(arg) : null;
const solvedUpTo = args.solved === undefined ? null : Number(args.solved);
if (solvedUpTo !== null && !(Number.isInteger(solvedUpTo) && solvedUpTo >= 1)) { console.error('--solved needs a level number, e.g. --solved 25'); process.exit(2); }

const widths = String(args.widths ?? '375,768,1440').split(',').map(Number).filter(Boolean);
const sizes = args.sizes
  ? String(args.sizes).split(',').map((s) => s.split('x').map(Number)).filter(([w, h]) => w && h).map(([width, height]) => ({ width, height }))
  : widths.map((w) => ({ width: w, height: w < 768 ? 844 : w < 1200 ? 1024 : 900 }));
if (args.landscape) sizes.push({ width: 812, height: 375 });
if (args.short) sizes.push({ width: 375, height: 600 });
const outDir = resolve(ROOT, args.out ?? 'look-out');
mkdirSync(outDir, { recursive: true });

let target;
try { target = resolveTarget(args.url); } catch (err) { console.error(err.message); process.exit(2); }
const browser = await launch();
const problems = [];
const shots = await Promise.all(sizes.map(shoot));
await browser.close();
target.cleanup();

for (const s of shots) console.log(s.path ? s.path : `${s.size}: ${s.error}`);
if (problems.length) {
  console.log('\nOn the page:');
  for (const p of [...new Set(problems)]) console.log(`  ${p}`);
}
process.exit(shots.some((s) => !s.path) ? 1 : 0);

async function shoot(size) {
  const label = `${size.width}x${size.height}`;
  const context = await browser.newContext(contextOptions(size));
  await context.addInitScript(INSTRUMENT);
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`[${label}] page error: ${String(e.message).split('\n')[0]}`));
  page.on('console', (msg) => { if (msg.type() === 'error') problems.push(`[${label}] console.error: ${msg.text().slice(0, 160)}`); });
  try {
    await page.goto(withHash(target.url, 'debug'), { waitUntil: 'load' });
    await waitInteractive(page);
    if (!(await hasDebug(page))) throw new Error('window.__lightsOut.debug is missing (is #debug passed through?)');
    await reach(page);
    await settle(page);
    const path = join(outDir, `${args.state.replace(':', '-')}${solvedUpTo ? `-solved${solvedUpTo}` : ''}-${label}.png`);
    await page.screenshot({ path });
    return { size: label, path };
  } catch (err) {
    return { size: label, error: err instanceof Skip ? `skipped: ${err.message}` : String(err.message).split('\n')[0] };
  } finally {
    await context.close();
  }
}

async function reach(page) {
  if (solvedUpTo) {
    await page.waitForFunction(() => window.__lightsOut.debug.state().levels?.status === 'ready', null, { timeout: 10000 })
      .catch(() => { throw new Error('levels never became ready'); });
    const unlock = await page.evaluate(() => typeof window.__lightsOut.debug.commands()['progress.unlock'] === 'function');
    if (!unlock) throw new Error('--solved needs the progress.unlock console command');
    await page.evaluate((n) => window.__lightsOut.debug.commands()['progress.unlock']([String(n)]), solvedUpTo);
  }
  if (kind === 'board') {
    await emit(page, 'variety:open', { room: arg });
    const shown = await page.waitForFunction((id) => {
      const view = document.querySelector(`[data-screen="variety"]:not([hidden]) [data-room-view="${CSS.escape(id)}"]`);
      return !!view && view.getClientRects().length > 0;
    }, arg, { timeout: 3000 }).then(() => true, () => false);
    if (!shown) {
      const refused = await page.evaluate(() => window.__lightsOut.debug.events().filter((e) => e.type === 'variety:refused').at(-1)?.payload?.reason ?? null);
      throw new Error(refused === 'locked' ? `board "${arg}" is locked: add --solved 20` : refused ? `variety:open refused: ${refused}` : `board "${arg}" never showed ([data-room-view="${arg}"])`);
    }
    return;
  }
  if (kind === 'home' || kind === 'console') {
    await emit(page, 'nav:go', { screen: 'home' });
    if (kind === 'console') await page.locator('[data-console]').first().waitFor({ state: 'visible', timeout: 3000 })
      .catch(() => problems.push('no visible [data-console] with #debug'));
    return;
  }
  await page.waitForFunction(() => window.__lightsOut.debug.state().levels?.status === 'ready', null, { timeout: 10000 })
    .catch(() => { throw new Error('levels never became ready'); });
  const state = await debugState(page);
  const def = state.levels.list.find((l) => l.id === level);
  if (!def) throw new Error(`no level ${level} in the levels slice`);
  const room = def.pack && def.pack !== 'classic';
  const unlocked = state.progress?.unlockedUpTo ?? 1;
  // the rooms open after classic level 20; inside a room, its first level is open
  if (room && unlocked < 20) await page.evaluate(() => window.__lightsOut.debug.commands()['progress.unlock'](['20']));
  else if (!room && level > unlocked) await unlockUpTo(page, level);
  await emit(page, 'levels:start', { levelId: level });
  await enterLevel(page, 4000, { cells: null });
  if (kind === 'aim') {
    // hold a finger on a cell near the middle of the board (a lit one if there is one), slightly off its centre
    const at = await page.evaluate((PLAY) => {
      const cells = [...document.querySelectorAll(`${PLAY} [data-cell]`)];
      const visible = cells.filter((c) => { const r = c.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
      const mid = visible[Math.floor(visible.length / 2)];
      const pick = visible.filter((c) => c.dataset.lit === 'true').sort((a, b) => Math.abs(cells.indexOf(a) - cells.indexOf(mid)) - Math.abs(cells.indexOf(b) - cells.indexOf(mid)))[0] ?? mid;
      const r = pick.getBoundingClientRect();
      return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.6, aim: document.querySelector(`${PLAY} [data-board]`).dataset.aim === 'true' };
    }, PLAY);
    if (!at.aim) problems.push(`level ${level}: the board is not in aim mode at this size (no bubble)`);
    const finger = await fingers(page);
    await finger.down(at.x, at.y);
    await finger.move(at.x + 2, at.y + 2);
    if (at.aim) await page.waitForSelector('[data-aim-bubble][data-open="true"]', { timeout: 2000 }).catch(() => problems.push('no open [data-aim-bubble] while a finger is held'));
    return;
  }
  if (kind === 'hint') {
    await emit(page, 'hints:request', {});
    await page.waitForFunction((CELLS) => document.querySelector(`${CELLS}[data-hint="true"]`), CELLS, { timeout: 2000 })
      .catch(() => problems.push('no [data-hint="true"] cell after hints:request'));
  }
  if (kind === 'solved') {
    const after = await sheetOpens(page);
    let b = await readBoard(page);
    for (const i of solve(b.lit) ?? []) {
      if (b.pointer >= 0 && b.pointer !== i) { /* tutorial pointer may differ; any fewest-moves order works */ }
      await emit(page, 'board:press', { index: i });
    }
    b = await readBoard(page);
    if (b.lit !== 0) {
      // fall back to tapping like a player
      for (const i of solve(b.lit) ?? []) b = await tap(page, b, i);
    }
    await waitForSolvedSheet(page, { after });
  }
}

/** Solve levels 1..N-1 through the event bus so level N is unlocked (fresh context = no progress). */
async function unlockUpTo(page, n) {
  const list = (await debugState(page)).levels.list;
  for (let id = 1; id < n; id++) {
    await emit(page, 'levels:start', { levelId: id });
    for (const i of solve(list[id - 1].cells) ?? []) await emit(page, 'board:press', { index: i });
  }
  const unlocked = (await debugState(page)).progress?.unlockedUpTo;
  if (unlocked !== undefined && unlocked < n) problems.push(`level ${n} still locked after solving 1–${n - 1} (unlockedUpTo ${unlocked})`);
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
