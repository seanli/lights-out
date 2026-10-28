// offline: keeps the game usable without a connection and says so in plain words.
// In the PWA build it registers the service worker; everywhere else the page simply never needs the network.
import * as v from 'valibot';
import type { ModuleDef, OfflineState } from '../../contracts';

const Copy = v.object({ ready: v.string(), offline: v.string(), workerFailed: v.string() });

const offline: ModuleDef = {
  manifest: {
    name: 'offline',
    emits: ['offline:status_changed'],
    listens: [],
    owns: ['offline'],
    optional: ['env', 'view', 'clock'],
    data: { copy: Copy },
  },
  init(ctx) {
    const copy = ctx.data.copy as v.InferOutput<typeof Copy>;
    const env = ctx.service('env');
    const view = ctx.service('view');
    const clock = ctx.service('clock');
    const nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator;
    const target = env?.target ?? 'dev';
    const offs: (() => void)[] = [];

    const set = (patch: Partial<OfflineState>) => {
      const next = { ...ctx.read('offline')!, ...patch };
      ctx.write('offline', next);
      ctx.emit('offline:status_changed', { target: next.target, worker: next.worker, online: next.online });
    };
    ctx.write('offline', { target, worker: 'none', online: nav?.onLine ?? true });

    const onConnection = () => {
      const online = nav?.onLine ?? true;
      set({ online });
      if (online) view?.clearNotice('offline');
      else view?.notice('offline', copy.offline, 'info');
    };

    async function registerWorker() {
      const sw = nav?.serviceWorker;
      if (!sw) {
        set({ worker: 'error', reason: 'This browser has no service worker support.' });
        ctx.report({ service: 'offline worker', mode: 'mock', ok: false, detail: 'This browser cannot install offline support; the game works while the page is open.' });
        return;
      }
      const firstInstall = !sw.controller;
      set({ worker: 'registering' });
      try {
        await sw.register('./sw.js', { scope: './' });
        await sw.ready;
        set({ worker: 'ready', reason: undefined });
        ctx.report({ service: 'offline worker', mode: 'live', ok: true, detail: 'Installed. The game opens with no connection.' });
        if (firstInstall) {
          view?.notice('offline-ready', copy.ready, 'info');
          clock?.setTimeout(() => view?.clearNotice('offline-ready'), 4000);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        set({ worker: 'error', reason });
        ctx.log.error(`Service worker failed: ${reason}`, err);
        ctx.report({ service: 'offline worker', mode: 'live', ok: false, detail: `Couldn't install offline support (${reason}). Reload with a connection to retry.` });
        view?.notice('offline', copy.workerFailed, 'warn');
      }
    }

    return {
      start() {
        if (typeof window !== 'undefined') {
          window.addEventListener('online', onConnection);
          window.addEventListener('offline', onConnection);
          offs.push(() => window.removeEventListener('online', onConnection), () => window.removeEventListener('offline', onConnection));
        }
        if (nav && !nav.onLine) onConnection();
        if (target === 'pwa') void registerWorker();
        else {
          ctx.report({
            service: 'offline worker',
            mode: 'mock',
            ok: true,
            detail: target === 'artifact'
              ? 'Not used here: this page needs no connection once open, but it cannot install itself for offline launch.'
              : 'Not used in this build; everything the game needs is inside the page.',
          });
        }
      },
      stop() { offs.forEach((f) => f()); },
      debug: () => ctx.read('offline'),
    };
  },
};
export default offline;
