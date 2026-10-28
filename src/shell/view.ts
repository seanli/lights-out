// The view service: the only way modules touch the page.
// The shell shows the screen and sheet the nav slice names; modules render inside their regions.
import type { NavState } from '../contracts/entities';
import type { Tone, ViewService } from '../contracts/services';

/** how deep a screen sits: a higher number entered from a lower one slides in "forward" */
const DEPTH: Record<string, number> = { home: 0, variety: 1, play: 2, learn: 3 };

export interface ShellView extends ViewService {
  applyNav(nav: NavState | undefined): void;
  root: HTMLElement;
}

export function createView(root: HTMLElement): ShellView {
  root.classList.add('app');
  const notices = el('div', 'notices');
  notices.setAttribute('aria-live', 'polite');
  const screens = el('main', 'screens');
  const sheetHost = el('div', 'sheet-host');
  const backdrop = el('div', 'sheet-backdrop');
  backdrop.hidden = true;
  sheetHost.append(backdrop);
  const overlays = el('div', 'overlays');
  root.append(notices, screens, sheetHost, overlays);

  const regions = new Map<string, HTMLElement>();
  const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let openSheet: string | null = null;
  let returnFocus: HTMLElement | null = null;
  let shownScreen: string | null = null;
  let homeScroll = 0; // the level path's scroll position, kept while another screen is up

  /** fade the incoming screen in from the room (CSS: .screen[data-enter]); nothing with reduced motion */
  function enter(node: HTMLElement, from: string, to: string) {
    if (reduce?.matches) return;
    node.dataset.enter = (DEPTH[to] ?? 0) >= (DEPTH[from] ?? 0) ? 'forward' : 'back';
  }
  function entered(e: Event) {
    const node = e.currentTarget as HTMLElement;
    if (e.target === node) delete node.dataset.enter; // cells and stars animate inside the screen too
  }

  function region(name: string): HTMLElement {
    const existing = regions.get(name);
    if (existing) return existing;
    const [kind, id = ''] = name.split(':');
    let node: HTMLElement;
    if (kind === 'screen') {
      node = el('section', 'screen');
      node.dataset.screen = id;
      node.hidden = true;
      node.addEventListener('animationend', entered);
      node.addEventListener('animationcancel', entered);
      screens.append(node);
    } else if (kind === 'sheet') {
      node = el('div', 'sheet');
      node.dataset.sheet = id;
      node.setAttribute('role', 'dialog');
      node.setAttribute('aria-modal', 'true');
      node.hidden = true;
      sheetHost.append(node);
    } else if (kind === 'slot') {
      // a detached container one module fills and another places in its layout
      node = el('div', 'slot');
      node.dataset.slot = id;
    } else {
      node = el('div', 'overlay');
      node.dataset.overlay = id || name;
      overlays.append(node);
    }
    regions.set(name, node);
    return node;
  }

  function showSheet(id: string | null) {
    if (id === openSheet) return;
    const prev = openSheet ? regions.get(`sheet:${openSheet}`) : undefined;
    openSheet = id;
    if (prev) {
      prev.dataset.open = 'false';
      const hide = () => { if (prev.dataset.open === 'false') prev.hidden = true; };
      if (reduce?.matches) hide(); else setTimeout(hide, 320);
    }
    const next = id ? region(`sheet:${id}`) : undefined;
    // a sheet is modal: the screen behind it can't be tabbed into or tapped
    screens.inert = !!next;
    if (next && !prev) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!next && returnFocus) {
      const target = returnFocus;
      returnFocus = null;
      if (target.isConnected && !target.closest('[hidden]')) target.focus({ preventScroll: true });
    }
    backdrop.hidden = !next;
    backdrop.dataset.open = next ? 'true' : 'false';
    if (next) {
      next.hidden = false;
      next.dataset.open = 'false';
      // next frame so the open transition runs
      requestAnimationFrame(() => requestAnimationFrame(() => { if (openSheet === id) next.dataset.open = 'true'; }));
      const focusable = next.querySelector<HTMLElement>('[data-autofocus], button');
      focusable?.focus({ preventScroll: true });
    }
  }

  return {
    root,
    region,
    notice(id, text, tone: Tone = 'info') {
      let n = notices.querySelector<HTMLElement>(`[data-notice="${CSS.escape(id)}"]`);
      if (!n) {
        n = el('div', 'notice');
        n.dataset.notice = id;
        n.setAttribute('role', tone === 'error' ? 'alert' : 'status');
        notices.append(n);
      }
      n.dataset.tone = tone;
      n.textContent = text;
    },
    clearNotice(id) {
      notices.querySelector(`[data-notice="${CSS.escape(id)}"]`)?.remove();
    },
    reducedMotion: () => !!reduce?.matches,
    applyNav(nav) {
      const screen = nav?.screen ?? 'home';
      const prevScreen = shownScreen;
      const changed = prevScreen !== null && prevScreen !== screen;
      const home = regions.get('screen:home');
      if (changed && prevScreen === 'home' && home) homeScroll = home.scrollTop; // read before it hides
      for (const [name, node] of regions) {
        if (!name.startsWith('screen:')) continue;
        node.hidden = name !== `screen:${screen}`;
        if (node.hidden) delete node.dataset.enter;
      }
      root.dataset.activeScreen = screen;
      shownScreen = screen;
      const incoming = regions.get(`screen:${screen}`);
      if (changed && incoming) {
        // back on the level path: where the player left it (home-view still reveals a newly suggested level)
        if (screen === 'home' && homeScroll) incoming.scrollTop = homeScroll;
        enter(incoming, prevScreen, screen);
      }
      if (changed) returnFocus = null; // a new screen: the old focus target is gone
      showSheet(nav?.sheet ?? null);
      // keep keyboard and screen-reader users in place: focus lands on the new screen, not <body>
      const active = document.activeElement;
      const lost = !active || active === document.body || !!(active as HTMLElement).closest?.('[hidden]');
      if (changed && !nav?.sheet && lost) {
        const node = regions.get(`screen:${screen}`);
        if (node) {
          if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
          node.focus({ preventScroll: true });
        }
      }
    },
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  return n;
}
