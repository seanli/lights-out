// Entry point: find modules, load data, boot the kernel, show the screen nav asks for.
import './polyfills';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/components.css';
import './shell.css';
import { CONTRACT_VERSION, type NavState } from '../contracts/entities';
import type { Snapshot } from '../contracts/kernel';
import type { Env } from '../contracts/services';
import { createKernel, DataError, type Kernel } from '../kernel';
import { discoverModules, liveData } from './registry';
import { bindHistory } from './history';
import { createView } from './view';

function detectEnv(): Env {
  const debug = /(^|[#&?])debug\b/.test(location.hash) || /[?&]debug\b/.test(location.search);
  const target: Env['target'] =
    import.meta.env.MODE === 'pwa' ? 'pwa' : import.meta.env.DEV ? 'dev' : location.protocol === 'file:' ? 'file' : 'artifact';
  return { target, debug, buildId: __BUILD_ID__ };
}

function seed(): number {
  try { return crypto.getRandomValues(new Uint32Array(1))[0]!; } catch { return Date.now() >>> 0; }
}

function showFatal(root: HTMLElement, title: string, lines: string[]) {
  root.replaceChildren();
  const box = document.createElement('div');
  box.className = 'fatal';
  box.setAttribute('role', 'alert');
  const h = document.createElement('h1');
  h.textContent = title;
  box.append(h);
  for (const line of lines) {
    const p = document.createElement('p');
    p.textContent = line;
    box.append(p);
  }
  root.append(box);
}

interface HotData { contract?: number; snapshot?: Snapshot }

let kernel: Kernel | undefined;

function start(hotData: HotData = {}) {
  const root = document.getElementById('app')!;
  const env = detectEnv();
  const view = createView(root);
  const k = createKernel({
    data: liveData,
    seed: seed(),
    echoLogs: env.target === 'dev' && env.debug,
    // never silent: a part that breaks mid-game says so, and progress is saved as it happens
    onFault: ({ module, kind }) => kind !== 'start' && view.notice('shell:fault', `Part of the game hit a problem (${module}). Your progress is saved; reload the page if something looks wrong.`, 'error'),
  });
  kernel = k;
  k.provide('view', view);
  k.provide('env', env);
  const modules = discoverModules();
  modules.forEach((m) => k.register(m));

  const snapshot = hotData.contract === CONTRACT_VERSION ? hotData.snapshot : undefined;
  let lastNav: NavState | undefined;
  const syncNav = () => {
    const nav = k.read('nav') as NavState | undefined;
    if (nav !== lastNav) { lastNav = nav; view.applyNav(nav); }
  };
  k.debug.onChange(syncNav);

  try {
    const report = k.boot({ snapshot });
    if (report.failed.length) {
      const names = report.failed.map((f) => f.name).join(', ');
      view.notice('shell:modules', `Part of the game didn't load (${names}). Reload the page to try again.`, 'error');
    }
  } catch (err) {
    if (err instanceof DataError) {
      showFatal(root, "The game can't start because its data has a mistake.", err.problems);
    } else {
      showFatal(root, "The game couldn't start.", [err instanceof Error ? err.message : String(err), 'Reload the page to try again.']);
    }
    console.error(err);
    return;
  }
  syncNav();
  bindHistory(k, env);
  if (env.debug) window.__lightsOut = { debug: k.debug, kernel: k };
  requestAnimationFrame(() => requestAnimationFrame(() => performance.mark('lo:interactive')));
}

const hot = window.claude?.hot;
hot?.snapshot?.(() => ({ contract: CONTRACT_VERSION, snapshot: kernel?.snapshot() }) satisfies HotData);
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
