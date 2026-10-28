// Browser and phone Back follow the game's screens (home ← play ← learn), so the system back
// gesture never drops the player out of the game. The shell owns the URL; nav owns the screen.
import type { NavState, Screen } from '../contracts/entities';
import type { Env } from '../contracts/services';
import type { Kernel } from '../kernel';

const ROUTED: Screen[] = ['play', 'learn', 'variety', 'custom'];

function hashScreen(): Screen {
  const h = location.hash.replace(/^#/, '') as Screen;
  return ROUTED.includes(h) ? h : 'home';
}

function urlFor(screen: Screen): string {
  return screen === 'home' ? location.pathname + location.search : `#${screen}`;
}

export function bindHistory(k: Kernel, env: Env): void {
  // #debug owns the hash (the artifact frame passes only one plain #name), so debug sessions skip this.
  if (env.debug || typeof history === 'undefined') return;
  // A reload never lands mid-level: start from home with a clean URL.
  if (location.hash && hashScreen() !== 'home') {
    try { history.replaceState(null, '', urlFor('home')); } catch { /* frame may refuse; harmless */ }
  }
  /** our view of the history entries since load, oldest first */
  const stack: Screen[] = ['home'];
  let ignorePops = 0;
  let applying = false;

  k.debug.onChange(() => {
    if (applying) return;
    const nav = k.read('nav') as NavState | undefined;
    if (!nav || nav.screen === stack.at(-1)) return;
    const i = stack.lastIndexOf(nav.screen);
    try {
      if (i >= 0) {
        // the game went back to a screen already in history: step back to it
        const steps = stack.length - 1 - i;
        stack.length = i + 1;
        ignorePops++;
        history.go(-steps);
      } else {
        stack.push(nav.screen);
        history.pushState({ screen: nav.screen }, '', urlFor(nav.screen));
      }
    } catch { /* history unavailable in this frame: the game still works, Back just leaves */ }
  });

  window.addEventListener('popstate', () => {
    if (ignorePops > 0) { ignorePops--; return; }
    let target = hashScreen();
    const board = k.read('board') as { status?: string } | undefined;
    if (target === 'play' && (!board || board.status === 'empty')) target = 'home';
    const i = stack.lastIndexOf(target);
    if (i >= 0) stack.length = i + 1; else stack.push(target);
    const nav = k.read('nav') as NavState | undefined;
    if (nav && (nav.screen !== target || nav.sheet)) {
      applying = true;
      try { k.emit('nav:go', { screen: target }, 'shell'); } finally { applying = false; }
    }
  });
}
