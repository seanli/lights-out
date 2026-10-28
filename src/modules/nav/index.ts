// nav: which screen and which sheet are showing. The shell does the showing.
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
    const go = (screen: Screen) => {
      const c = cur();
      set({ screen, sheet: null, previous: screen === c.screen ? (c.previous ?? null) : c.screen });
    };
    ctx.write('nav', { screen: 'home', sheet: null, previous: null });

    ctx.on('nav:go', ({ screen }) => go(screen));
    ctx.on('nav:back', () => {
      const c = cur();
      const target = c.previous && c.previous !== c.screen ? c.previous : 'home';
      set({ screen: target, sheet: null, previous: null });
    });
    ctx.on('nav:open_sheet', ({ sheet }) => set({ ...cur(), sheet }));
    ctx.on('nav:close_sheet', () => set({ ...cur(), sheet: null }));
    ctx.on('levels:started', () => go('play'));
  },
};
export default nav;
