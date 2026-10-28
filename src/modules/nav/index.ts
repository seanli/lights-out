// nav: which screen and which sheet are showing. The shell does the showing.
// Back follows the trail of screens the player came through (menu → board → level → Learn and back again).
import type { ModuleDef, NavState, Screen } from '../../contracts';

const nav: ModuleDef = {
  manifest: {
    name: 'nav',
    emits: ['nav:changed'],
    listens: ['nav:go', 'nav:back', 'nav:open_sheet', 'nav:close_sheet', 'levels:started'],
    owns: ['nav'],
  },
  init(ctx) {
    const cur = () => ctx.read('nav')!;
    const set = (next: NavState) => {
      const c = cur();
      if (c.screen === next.screen && c.sheet === next.sheet && (c.previous ?? null) === (next.previous ?? null)) return;
      ctx.write('nav', next);
      ctx.emit('nav:changed', { screen: next.screen, sheet: next.sheet });
    };
    /** screens before the current one, oldest first; the slice's `previous` is its last entry */
    let trail: Screen[] = [];
    /** a restored snapshot may not match the trail: fall back to what the slice says */
    const sync = (c: NavState) => { if ((trail.at(-1) ?? null) !== (c.previous ?? null)) trail = c.previous ? [c.previous] : []; };
    const go = (screen: Screen) => {
      const c = cur();
      sync(c);
      if (screen !== c.screen) {
        const i = trail.indexOf(screen);
        // back to a screen already on the trail: drop what came after it; else this screen joins the trail
        if (i >= 0) trail = trail.slice(0, i); else trail = [...trail, c.screen];
      }
      set({ screen, sheet: null, previous: trail.at(-1) ?? null });
    };
    ctx.write('nav', { screen: 'home', sheet: null, previous: null });

    ctx.on('nav:go', ({ screen }) => go(screen));
    ctx.on('nav:back', () => {
      const c = cur();
      sync(c);
      const target = trail.pop() ?? 'home';
      set({ screen: target === c.screen ? 'home' : target, sheet: null, previous: trail.at(-1) ?? null });
    });
    ctx.on('nav:open_sheet', ({ sheet }) => set({ ...cur(), sheet }));
    ctx.on('nav:close_sheet', () => set({ ...cur(), sheet: null }));
    ctx.on('levels:started', () => go('play'));
  },
};
export default nav;
