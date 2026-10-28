// Where the probe and look scripts point the browser, and how the browser is set up.
// Default target: dist/artifact.html wrapped in the skeleton the artifact host adds.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const ARTIFACT = join(ROOT, 'dist/artifact.html');

const HOST_HEAD =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
  '<style>:root{color-scheme:light}body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style>' +
  '</head><body>';
const HOST_TAIL = '</body></html>';

/**
 * Returns { url, file, cleanup }. `file` is the local file the page came from (for page weight), or null.
 * Throws a plain-words Error when there is nothing to load.
 */
export function resolveTarget(url) {
  if (url) {
    const file = url.startsWith('file:') ? fileURLToPath(url.split('#')[0]) : existsSync(url) ? resolve(url) : null;
    const href = !url.includes('://') && file ? pathToFileURL(file).href : url;
    return { url: href, file, wrapped: false, cleanup() {} };
  }
  if (!existsSync(ARTIFACT)) throw new Error('dist/artifact.html not found: run `npm run build` first (or pass --url <url>).');
  const dir = mkdtempSync(join(tmpdir(), 'lights-out-host-'));
  const page = join(dir, 'index.html');
  writeFileSync(page, HOST_HEAD + readFileSync(ARTIFACT, 'utf8') + HOST_TAIL);
  return { url: pathToFileURL(page).href, file: ARTIFACT, wrapped: true, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export const withHash = (url, word) => (url.includes('#') ? `${url}&${word}` : `${url}#${word}`);

export const PHONE = { width: 390, height: 844 };

/** Browser context options for a viewport; phones and tablets get touch + mobile viewport handling. */
export function contextOptions({ width, height }, extra = {}) {
  const mobile = width < 1024 || height < 500;
  return { viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true, isMobile: mobile, ...extra };
}

/**
 * Instrumentation installed before the page's own scripts (context.addInitScript).
 * window.__probe collects:
 *  - taps:   per pointerdown on a [data-cell]: { index, down (event timeStamp), entry (when the page got it),
 *            dom (first data-lit change), frame (the next animation frame after that), win (this tap solved the board) }
 *  - sweeps: { frames, ms } rAF callbacks counted for 800ms after an armed tap (armSweep())
 *  - sheets: { name, at } each time a [data-sheet] goes from [hidden] to shown
 */
export const INSTRUMENT = `(() => {
  if (window.__probe) return;
  const P = window.__probe = { taps: [], sweeps: [], sheets: [], armed: false, armSweep() { P.armed = true; } };
  let pending = null;
  addEventListener('pointerdown', (e) => {
    const cell = e.target && e.target.closest ? e.target.closest('[data-cell]') : null;
    if (!cell) return;
    pending = { index: Number(cell.dataset.index), down: e.timeStamp, entry: performance.now(), dom: null, frame: null };
    P.taps.push(pending);
    if (P.armed) {
      P.armed = false;
      const t0 = e.timeStamp; let n = 0;
      const tick = (t) => {
        if (t - t0 >= 800) { P.sweeps.push({ frames: n, ms: t - t0 }); return; }
        if (t >= t0) n++;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }, { capture: true });
  const isCellNode = (n) => n.nodeType === 1 && (n.matches('[data-cell]') || !!n.querySelector('[data-cell]'));
  new MutationObserver((records) => {
    const now = performance.now();
    for (const r of records) {
      const t = r.target;
      if (r.type === 'attributes' && r.attributeName === 'hidden' && t.dataset && t.dataset.sheet && !t.hidden && r.oldValue !== null) {
        P.sheets.push({ name: t.dataset.sheet, at: now });
      }
      if (pending && pending.dom === null && (
        (r.type === 'attributes' && r.attributeName === 'data-lit') ||
        (r.type === 'childList' && [...r.addedNodes].some(isCellNode)))) {
        const p = pending; pending = null; p.dom = now;
        const board = document.querySelector('[data-screen="play"] [data-board]');
        p.win = !!board && board.dataset.status === 'solved';
        requestAnimationFrame(() => { p.frame = performance.now(); });
      }
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-lit', 'hidden'] });
})();`;

/** Makes localStorage throw on access, like a sandboxed frame with storage blocked. */
export const BLOCK_STORAGE = `Object.defineProperty(window, 'localStorage', {
  configurable: true,
  get() { throw new DOMException('Access is denied for this document.', 'SecurityError'); },
});`;

export async function launch() {
  const { chromium } = await import('playwright-core');
  return chromium.launch();
}
