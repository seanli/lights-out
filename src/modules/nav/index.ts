// nav: which screen and which sheet are showing. The shell does the showing.
import type { ModuleDef, NavState } from '../../contracts';

const nav: ModuleDef = {
  manifest: {
    name: 'nav',
    emits: ['nav:changed'],
    listens: ['nav:go', 'nav:open_sheet', 'nav:close_sheet', 'levels:started'],
    owns: ['nav'],
  },
  init(ctx) {
    const set = (next: NavState) => {
      const cur = ctx.read('nav');
      if (cur && cur.screen === next.screen && cur.sheet === next.sheet) return;
      ctx.write('nav', next);
      ctx.emit('nav:changed', next);
    };
    ctx.write('nav', { screen: 'home', sheet: null });

    ctx.on('nav:go', ({ screen }) => set({ screen, sheet: null }));
    ctx.on('nav:open_sheet', ({ sheet }) => set({ screen: ctx.read('nav')!.screen, sheet }));
    ctx.on('nav:close_sheet', () => set({ screen: ctx.read('nav')!.screen, sheet: null }));
    ctx.on('levels:started', () => set({ screen: 'play', sheet: null }));
  },
};
export default nav;
