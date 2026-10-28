// A scripted player that only uses the hooks in src/contracts/dom.ts.
import { pressMask, solve } from './solver.mjs';

/** Thrown when a DOM hook a step needs isn't rendered yet: the probe reports SKIP, not FAIL. */
export class Skip extends Error {}

export const count = (page, sel) => page.locator(sel).count();

// Main-board hooks, scoped to the play screen (other screens may draw boards of their own).
export const PLAY = '[data-screen="play"]';
export const BOARD = `${PLAY} [data-board]`;
export const CELLS = `${PLAY} [data-cell]`;

/** Visible = rendered with a box and not inside a [hidden] region. */
export async function isVisible(page, sel) {
  return page.evaluate((sel) => [...document.querySelectorAll(sel)].some((el) => !el.closest('[hidden]') && el.getClientRects().length > 0), sel);
}

/**
 * The board as the player sees it, in one round trip. With `prev` (a lit mask) it first waits in-page
 * (up to 2s) until the lights differ from `prev`, then one more frame so tutorial/hint marks settle.
 */
export async function readBoard(page, prev = null) {
  return page.evaluate(async ({ prev, PLAY }) => {
    const snap = () => {
      const board = document.querySelector(`${PLAY} [data-board]`);
      const cells = [...document.querySelectorAll(`${PLAY} [data-cell]`)];
      let lit = 0, pointer = -1, hint = -1;
      const pos = [];
      for (const c of cells) {
        const i = Number(c.dataset.index);
        if (c.dataset.lit === 'true') lit |= 1 << i;
        if (c.dataset.pointer === 'true') pointer = i;
        if (c.dataset.hint === 'true') hint = i;
        const r = c.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const onScreen = r.width > 0 && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
        const hit = onScreen ? document.elementFromPoint(x, y) : null;
        const ok = !!hit && (hit === c || c.contains(hit));
        let cover = null;
        if (!ok && hit) {
          cover = hit.tagName.toLowerCase() + [...hit.attributes]
            .filter((a) => a.name.startsWith('data-') || a.name === 'class')
            .map((a) => `[${a.name}="${a.value}"]`).join('');
        }
        pos[i] = { x, y, ok, onScreen, cover };
      }
      const movesEl = document.querySelector(`${PLAY} [data-moves]`);
      const label = document.querySelector(`${PLAY} [data-level-label]`);
      return {
        count: cells.length, lit, pointer, hint, pos,
        status: board?.dataset.status ?? null,
        moves: movesEl ? parseInt(movesEl.textContent.replace(/\D+/g, ''), 10) : null,
        level: label ? parseInt(label.textContent.replace(/\D+/g, ''), 10) || null : null,
      };
    };
    if (prev !== null) {
      const t0 = performance.now();
      while (snap().lit === prev && performance.now() - t0 < 2000) await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => setTimeout(r, 0));
    }
    return snap();
  }, { prev, PLAY });
}

/** Waits until a level with lights on is showing; SKIP when the play view has no cells at all. */
export async function enterLevel(page, timeout = 4000) {
  try {
    await page.waitForFunction((PLAY) => {
      const board = document.querySelector(`${PLAY} [data-board]`);
      const cells = document.querySelectorAll(`${PLAY} [data-cell]`);
      return !!board && !board.closest('[hidden]') && board.getClientRects().length > 0 && cells.length === 25 &&
        board.dataset.status !== 'solved' && [...cells].some((c) => c.dataset.lit === 'true');
    }, PLAY, { timeout, polling: 'raf' });
  } catch {
    if ((await count(page, CELLS)) === 0) throw new Skip('play view not rendered yet (no [data-screen="play"] [data-cell])');
    if ((await count(page, BOARD)) === 0) throw new Skip('play view has cells but no [data-board]');
    const b = await readBoard(page);
    throw new Error(`no playable level on screen (cells ${b.count}, board status ${b.status}, lit ${b.lit})`);
  }
  return readBoard(page);
}

/** Taps a visible control by data-action name (or a selector). SKIP when it isn't rendered. */
export async function tapAction(page, name, timeout = 4000) {
  const sel = name.startsWith('[') ? name : `[data-action="${name}"]`;
  if ((await count(page, sel)) === 0) throw new Skip(`${sel} not rendered yet`);
  await page.locator(`${sel} >> visible=true`).first().tap({ timeout });
}

async function tapCell(page, board, i) {
  const deadline = Date.now() + 3000;
  let b = board;
  while (!b.pos[i]?.ok) {
    if (Date.now() > deadline) {
      const p = b.pos[i];
      throw new Error(p ? `cell ${i} can't be tapped: ${p.onScreen ? `covered by ${p.cover ?? 'nothing'}` : 'off screen'}` : `cell ${i} missing`);
    }
    if (b.pos[i] && !b.pos[i].onScreen) await page.locator(`${CELLS}[data-index="${i}"]`).scrollIntoViewIfNeeded().catch(() => {});
    else await page.waitForTimeout(25);
    b = await readBoard(page);
  }
  await page.touchscreen.tap(b.pos[i].x, b.pos[i].y);
  return b;
}

/** Taps one cell and waits until the lights change. Returns the new board. `pace` ms waited first. */
export async function tap(page, board, i, pace = 0) {
  if (pace) await page.waitForTimeout(pace);
  const b = await tapCell(page, board, i);
  return readBoard(page, b.lit);
}

/**
 * Plays the showing level until the lights are out.
 * pointer: 'follow' taps the tutorial pointer whenever there is one (a player following the tutorial);
 *          'if-optimal' taps it only when it is on a fewest-moves solution.
 * first(board) may choose the first tap (e.g. the hinted cell). armSweep counts frames after the last tap.
 * pace waits that many ms before each tap, like a person (back-to-back taps queue behind the last repaint).
 */
export async function playLevel(page, { pointer = 'follow', armSweep = false, first = null, maxTaps = 60, board = null, pace = 0 } = {}) {
  let b = board ?? (await readBoard(page));
  if (b.count !== 25) throw new Error(`expected 25 [data-cell], found ${b.count}`);
  let taps = 0;
  while (b.lit !== 0) {
    if (taps >= maxTaps) throw new Error(`still not solved after ${taps} taps`);
    const s = solve(b.lit);
    if (!s) throw new Error(`the board on screen (mask ${b.lit}) has no solution`);
    let target = taps === 0 && first ? first(b) : -1;
    if (target < 0 && b.pointer >= 0 && (pointer === 'follow' || s.includes(b.pointer))) target = b.pointer;
    if (target < 0) target = s[0];
    if (armSweep && (b.lit ^ pressMask(target)) === 0) await page.evaluate(() => window.__probe?.armSweep());
    b = await tap(page, b, target, pace);
    taps++;
  }
  return { taps, board: b };
}

/** How many times a [data-sheet] named `name` has opened (went from [hidden] to shown) on this page. */
export const sheetOpens = (page, name = 'solved') =>
  page.evaluate((name) => window.__probe?.sheets.filter((s) => s.name === name).length ?? 0, name);

/**
 * Waits for the solved sheet (or, with allowComplete, the complete sheet) and returns { sheet, stars, result, at }.
 * `after`: the sheetOpens() count before this level, so a sheet still closing from the last level never counts.
 */
export async function waitForSolvedSheet(page, { after = null, timeout = 5000, allowComplete = false } = {}) {
  if ((await count(page, '[data-sheet="solved"]')) === 0 && !allowComplete) throw new Skip('solved sheet not rendered yet');
  const names = allowComplete ? ['solved', 'complete'] : ['solved'];
  await page.waitForFunction(({ names, after }) => {
    const el = [...document.querySelectorAll('[data-sheet]')].find((n) => names.includes(n.dataset.sheet) && !n.hidden && n.getClientRects().length > 0);
    if (!el) return false;
    if (after === null) return true;
    return window.__probe.sheets.filter((s) => names.includes(s.name)).length > after;
  }, { names, after }, { timeout, polling: 'raf' });
  return page.evaluate((names) => {
    const el = [...document.querySelectorAll('[data-sheet]')].find((n) => names.includes(n.dataset.sheet) && !n.hidden && n.getClientRects().length > 0);
    const s = el.matches('[data-stars-earned]') ? el : el.querySelector('[data-stars-earned]');
    const opened = window.__probe?.sheets.filter((x) => names.includes(x.name)).at(-1)?.at;
    return {
      sheet: el.dataset.sheet,
      stars: s ? Number(s.getAttribute('data-stars-earned')) : null,
      result: el.querySelector('[data-result]')?.textContent.trim() ?? null,
      at: opened ?? performance.now(),
    };
  }, names);
}

export async function readNumber(page, sel) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? parseInt(el.textContent.replace(/\D+/g, ''), 10) : null;
  }, sel);
}

export async function readTiles(page) {
  return page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('[data-level-tile]')].map((t) => [t.dataset.level, t.dataset.stars ?? null])));
}

/** The 'lo:interactive' mark's startTime in ms, or null if it never came. */
export async function waitInteractive(page, timeout = 5000) {
  await page.waitForFunction(() => performance.getEntriesByName('lo:interactive').length > 0, null, { timeout }).catch(() => {});
  return page.evaluate(() => performance.getEntriesByName('lo:interactive')[0]?.startTime ?? null);
}

/** The debug service, or null when the page doesn't expose window.__lightsOut.debug. */
export async function hasDebug(page, timeout = 3000) {
  return page.waitForFunction(() => !!window.__lightsOut?.debug, null, { timeout }).then(() => true, () => false);
}

export const emit = (page, type, payload = {}) =>
  page.evaluate(([type, payload]) => window.__lightsOut.debug.emit(type, payload), [type, payload]);

export const debugState = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__lightsOut.debug.state())));

/** Resolves when every finite CSS animation/transition on the page has finished (max `timeout` ms). */
export async function settle(page, timeout = 2000) {
  await page.evaluate(async (timeout) => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const finite = document.getAnimations().filter((a) => {
      const t = a.effect?.getComputedTiming?.();
      return t && Number.isFinite(t.endTime) && a.playState === 'running';
    });
    await Promise.race([Promise.all(finite.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, timeout))]);
  }, timeout);
}
