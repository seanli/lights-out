// The view service: the only way modules touch the page.
// The shell shows the screen and sheet the nav slice names; modules render inside their regions.
import type { NavState } from '../contracts/entities';
import type { Tone, ViewService } from '../contracts/services';

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

  function region(name: string): HTMLElement {
    const existing = regions.get(name);
    if (existing) return existing;
    const [kind, id = ''] = name.split(':');
    let node: HTMLElement;
    if (kind === 'screen') {
      node = el('section', 'screen');
      node.dataset.screen = id;
      node.hidden = true;
      screens.append(node);
    } else if (kind === 'sheet') {
      node = el('div', 'sheet');
      node.dataset.sheet = id;
      node.setAttribute('role', 'dialog');
      node.setAttribute('aria-modal', 'true');
      node.hidden = true;
      sheetHost.append(node);
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
      for (const [name, node] of regions) if (name.startsWith('screen:')) node.hidden = name !== `screen:${screen}`;
      root.dataset.activeScreen = screen;
      showSheet(nav?.sheet ?? null);
    },
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  return n;
}
