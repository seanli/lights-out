// console: the in-game debug console, only with #debug in the URL. Without it, init does nothing at all.
// Reads everything through the kernel's debug service; renders at most once per animation frame, open sections only.
import * as v from 'valibot';
import type { BoardState, HintsState, LogRecord, ModuleDef, ModuleStatus, NavState, Snapshot } from '../../contracts';
import { fmt, h, setAttr, setText } from '../../lib/dom';
import { boardRows, clip, fmtTime, groupEvents, isCells, isFact, litCount, cellName, parseLine, prettyJson, resultText, shortPayload, summarize } from './format';
import './console.css';

const SECTIONS = ['state', 'events', 'log', 'modules', 'services', 'snapshots'] as const;
type SectionId = (typeof SECTIONS)[number];
const UI_KEY = 'lights-out:console';
const HISTORY_MAX = 30;
const OUTPUT_MAX = 12;

const Rules = v.object({
  eventLimit: v.pipe(v.number(), v.integer(), v.minValue(1)),
  logLimit: v.pipe(v.number(), v.integer(), v.minValue(1)),
  snapshotLimit: v.pipe(v.number(), v.integer(), v.minValue(1)),
});
const Flags = v.object({ enabled: v.boolean() });
const s = v.string();
const Copy = v.object({
  title: s, collapse: s, expand: s,
  sections: v.object({ state: s, events: s, log: s, modules: s, services: s, snapshots: s }),
  stateMeta: s, eventsMeta: s, warnCount: s, errorCount: s, logQuiet: s, modulesMeta: s, servicesMeta: s, snapshotsMeta: s,
  none: s, noSnapshots: s, save: s, restore: s, live: s, mock: s, ok: s, notOk: s,
  inputLabel: s, placeholder: s, run: s, help: s, done: s, followed: s, unknown: s,
  emitUsage: s, badJson: s, notObject: s, emitted: s, noSlice: s, restoreUsage: s, noSnapshot: s,
  saved: s, restored: s, cleared: s, failed: s,
});
type CopyT = v.InferOutput<typeof Copy>;

interface Ui { collapsed: boolean; open: SectionId[]; history: string[] }
type Tone = 'warn' | 'error' | undefined;
interface Result { text: string; tone?: Tone }

function loadUi(): Ui {
  const fallback: Ui = { collapsed: true, open: ['state', 'events'], history: [] };
  try {
    const raw = JSON.parse(sessionStorage.getItem(UI_KEY) ?? 'null') as Partial<Ui> | null;
    if (!raw || typeof raw !== 'object') return fallback;
    return {
      collapsed: typeof raw.collapsed === 'boolean' ? raw.collapsed : fallback.collapsed,
      open: Array.isArray(raw.open) ? raw.open.filter((id): id is SectionId => (SECTIONS as readonly string[]).includes(id)) : fallback.open,
      history: Array.isArray(raw.history) ? raw.history.filter((x): x is string => typeof x === 'string').slice(-HISTORY_MAX) : [],
    };
  } catch {
    return fallback;
  }
}

const SVG = 'http://www.w3.org/2000/svg';
function chevron(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M6 9l6 6 6-6');
  svg.append(path);
  return svg;
}

const consoleModule: ModuleDef = {
  manifest: {
    name: 'console',
    emits: [],
    listens: [],
    owns: [],
    uses: ['view', 'debug', 'env'],
    optional: ['clock'],
    data: { rules: Rules, copy: Copy, flags: Flags },
  },
  init(ctx) {
    const env = ctx.need('env');
    const flags = ctx.data.flags as v.InferOutput<typeof Flags>;
    if (!env.debug || !flags.enabled) return;

    const debug = ctx.need('debug');
    const view = ctx.need('view');
    const rules = ctx.data.rules as v.InferOutput<typeof Rules>;
    const copy = ctx.data.copy as CopyT;
    const clock = ctx.service('clock');
    const now = () => clock?.now() ?? Date.now();
    const t0 = now();
    const time = (at: number) => fmtTime(at, t0);

    const ui = loadUi();
    const saveUi = () => { try { sessionStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* private mode: just forget */ } };
    const snapshots: { n: number; snap: Snapshot }[] = [];
    let snapCount = 0;
    let clearedAfter = 0;
    let historyPos = ui.history.length;
    let expandedEvent: number | null = null;
    let pickedModule: string | null = null;
    const expandedSlices = new Set<string>();
    let scheduled = false;
    let renders = 0;
    let lastRenderMs = 0;
    /** per part, the inputs it was last rendered from; unchanged inputs skip the DOM work */
    const rendered = new Map<string, unknown[]>();
    const changed = (part: string, keys: unknown[]) => {
      const prev = rendered.get(part);
      if (prev && prev.length === keys.length && prev.every((k, i) => Object.is(k, keys[i]))) return false;
      rendered.set(part, keys);
      return true;
    };
    const invalidate = (part: string) => { rendered.delete(part); schedule(); };

    // ---- DOM ----
    const region = view.region('overlay:console');
    const em = h('em', {});
    const barMeta = h('span', { class: 'console__meta' });
    const toggle = h('button', { class: 'btn btn--icon', type: 'button', 'data-console-toggle': '' }, chevron());
    const bar = h('div', { class: 'console__bar' }, h('span', { class: 'console__title' }, copy.title, em), barMeta, toggle);
    const body = h('div', { class: 'console__body' });
    const parts = new Map<SectionId, { head: HTMLButtonElement; meta: HTMLElement; content: HTMLElement }>();
    for (const id of SECTIONS) {
      const meta = h('span', { class: 'console__meta' });
      const head = h('button', { class: 'console__head', type: 'button', 'aria-expanded': String(ui.open.includes(id)), 'data-console-section': id }, copy.sections[id], meta);
      const content = h('div', { class: 'console__content', 'data-console-content': id });
      head.addEventListener('click', () => toggleSection(id));
      body.append(h('section', { class: 'console__section', 'data-section': id }, head, content));
      parts.set(id, { head, meta, content });
    }
    const out = h('div', { class: 'console__out', 'data-console-output': '', 'aria-live': 'polite' });
    const input = h('input', {
      class: 'console__input', 'data-console-input': '', type: 'text', placeholder: copy.placeholder, 'aria-label': copy.inputLabel,
      autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go',
    });
    const form = h('form', { class: 'console__cmd' }, input, h('button', { class: 'btn btn--secondary', type: 'submit' }, copy.run));
    const root = h('aside', { class: 'console', 'data-console': '', 'aria-label': copy.title }, bar, body, out, form);
    region.append(root);

    bar.addEventListener('click', () => setCollapsed(!ui.collapsed));
    form.addEventListener('submit', (e) => { e.preventDefault(); run(input.value); });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      historyPos = Math.max(0, Math.min(ui.history.length, historyPos + (e.key === 'ArrowUp' ? -1 : 1)));
      input.value = ui.history[historyPos] ?? '';
      input.setSelectionRange?.(input.value.length, input.value.length);
    });
    parts.get('state')!.content.addEventListener('click', (e) => {
      const name = (e.target as Element).closest<HTMLElement>('[data-slice]')?.dataset.slice;
      if (!name) return;
      if (!expandedSlices.delete(name)) expandedSlices.add(name);
      invalidate('state');
    });
    parts.get('events')!.content.addEventListener('click', (e) => {
      const seq = Number((e.target as Element).closest<HTMLElement>('[data-seq]')?.dataset.seq);
      if (!seq) return;
      expandedEvent = expandedEvent === seq ? null : seq;
      invalidate('events');
    });
    parts.get('modules')!.content.addEventListener('click', (e) => {
      const name = (e.target as Element).closest<HTMLElement>('[data-module]')?.dataset.module;
      if (!name) return;
      pickedModule = pickedModule === name ? null : name;
      invalidate('modules');
    });
    parts.get('snapshots')!.content.addEventListener('click', (e) => {
      const t = e.target as Element;
      if (t.closest('[data-console-snap]')) print(copy.save, exec('snap'));
      const n = t.closest<HTMLElement>('[data-console-restore]')?.dataset.consoleRestore;
      if (n) print(`${copy.restore} ${n}`, exec(`restore ${n}`));
    });

    function setCollapsed(collapsed: boolean) {
      ui.collapsed = collapsed;
      saveUi();
      rendered.clear();
      schedule();
    }

    function toggleSection(id: SectionId) {
      const open = !ui.open.includes(id);
      ui.open = open ? [...ui.open, id] : ui.open.filter((x) => x !== id);
      saveUi();
      setAttr(parts.get(id)!.head, 'aria-expanded', String(open));
      invalidate(id);
    }

    // ---- rendering: at most once per frame ----
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      const raf: (fn: () => void) => unknown = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
      raf(() => { scheduled = false; render(); });
    }

    function render() {
      const started = performance.now();
      renders++;
      setAttr(root, 'data-collapsed', String(ui.collapsed));
      setAttr(toggle, 'aria-label', ui.collapsed ? copy.expand : copy.collapse);
      setAttr(toggle, 'aria-expanded', String(!ui.collapsed));
      const logs = debug.logs();
      const counts = logCounts(logs);
      renderBar(counts);
      if (!ui.collapsed) {
        renderMetas(logs, counts);
        for (const id of SECTIONS) if (ui.open.includes(id)) renderers[id]();
      }
      lastRenderMs = performance.now() - started;
    }

    function logCounts(logs: LogRecord[]) {
      let warn = 0, error = 0;
      for (const l of logs) { if (l.level === 'warn') warn++; else if (l.level === 'error') error++; }
      return { warn, error };
    }

    const problems = ({ warn, error }: { warn: number; error: number }) =>
      [error ? fmt(copy.errorCount, { n: error }) : '', warn ? fmt(copy.warnCount, { n: warn }) : ''].filter(Boolean).join(' · ');

    function renderBar(counts: { warn: number; error: number }) {
      setText(em, `${env.target} · ${lastRenderMs.toFixed(1)}ms`);
      setAttr(em, 'title', `build ${env.buildId} · last render ${lastRenderMs.toFixed(2)}ms · ${renders} renders`);
      setText(barMeta, problems(counts));
      setAttr(barMeta, 'data-tone', counts.error ? 'error' : counts.warn ? 'warn' : null);
    }

    function renderMetas(logs: LogRecord[], { warn, error }: { warn: number; error: number }) {
      const meta = (id: SectionId, text: string, tone?: Tone) => {
        const el = parts.get(id)!.meta;
        setText(el, text);
        setAttr(el, 'data-tone', tone ?? null);
      };
      const state = debug.state();
      const board = state.board as BoardState | undefined;
      meta('state', board?.levelId ? `L${board.levelId} · ${board.status}` : fmt(copy.stateMeta, { count: Object.keys(state).length }));
      meta('events', fmt(copy.eventsMeta, { limit: rules.eventLimit }));
      meta('log', warn || error ? problems({ warn, error }) : fmt(copy.logQuiet, { count: logs.length }), warn || error ? 'warn' : undefined);
      const mods = debug.modules();
      const up = mods.filter((m) => m.status === 'started').length;
      meta('modules', fmt(copy.modulesMeta, { up, total: mods.length }), up < mods.length ? 'warn' : undefined);
      const svcs = debug.services();
      const ok = svcs.filter((x) => x.ok).length;
      meta('services', fmt(copy.servicesMeta, { ok, total: svcs.length }), ok < svcs.length ? 'warn' : undefined);
      meta('snapshots', fmt(copy.snapshotsMeta, { count: snapshots.length, limit: rules.snapshotLimit }));
    }

    const content = (id: SectionId) => parts.get(id)!.content;
    const empty = (text: string) => h('div', { class: 'console__empty' }, text);
    const pre = (text: string) => h('pre', { class: 'console__pre' }, text);

    const renderers: Record<SectionId, () => void> = {
      state() {
        const all = debug.state();
        const names = Object.keys(all).sort();
        if (!changed('state', [...names, ...names.map((n) => all[n]), ...expandedSlices])) return;
        const nodes: Node[] = [];
        const board = all.board as BoardState | undefined;
        if (board && isCells(board.cells)) {
          const hints = all.hints as HintsState | undefined;
          const nav = all.nav as NavState | undefined;
          const hint = hints?.status === 'showing' && hints.cell !== null ? hints.cell : null;
          const pairs: [string, string][] = [
            ['level', board.levelId === null ? '—' : String(board.levelId)], ['status', board.status],
            ['moves', String(board.moves)], ['par', String(board.par)],
            ['lit', `${litCount(board.cells)}/${board.cells.length}`], ['undo', `${board.history.length} deep`],
            ['hint', hint === null ? '—' : cellName(hint, board.shape?.cols)], ['screen', nav ? `${nav.screen}${nav.sheet ? `+${nav.sheet}` : ''}` : '—'],
          ];
          const kv = h('dl', { class: 'console__kv' });
          for (const [k, val] of pairs) kv.append(h('dt', {}, k), h('dd', {}, val));
          const grid = h('div', { class: 'console__grid', 'aria-label': 'board' });
          const cols = board.shape?.cols ?? 5;
          boardRows(board.cells, board.shape).forEach((row, r) => {
            const line = h('div', {});
            // a gap is a space, so a shaped board keeps its outline
            row.forEach((on, c) => line.append(on === null
              ? h('span', { 'data-gap': 'true' }, '\u2007')
              : h('span', { 'data-on': String(on), 'data-hint': r * cols + c === hint ? 'true' : null }, on ? '1' : '0')));
            grid.append(line);
          });
          nodes.push(h('div', { class: 'console__boardrow' }, kv, grid));
        }
        const list = h('div', { class: 'console__slices' });
        for (const name of names) {
          const open = expandedSlices.has(name);
          list.append(h('button', { class: 'console__slice', type: 'button', 'data-slice': name, 'aria-expanded': String(open) }, h('b', {}, name), h('span', {}, summarize(all[name]))));
          if (open) list.append(pre(prettyJson(all[name])));
        }
        if (names.length) nodes.push(list);
        if (!nodes.length) nodes.push(empty(copy.none));
        content('state').replaceChildren(...nodes);
      },

      events() {
        const events = debug.events();
        if (!changed('events', [events.at(-1), events.length, clearedAfter, expandedEvent])) return;
        const groups = groupEvents(events, rules.eventLimit, clearedAfter);
        const frag = document.createDocumentFragment();
        for (const g of groups) {
          const rec = g.last;
          const tone = g.types.some((t) => /failed$/.test(t)) ? 'error' : g.types.some((t) => /refused$/.test(t)) ? 'warn' : null;
          const name = h('span', {});
          const mod = g.types[0]!.split(':')[0];
          g.types.forEach((t, i) => {
            if (i) name.append('→');
            const label = i && t.split(':')[0] === mod ? t.slice(mod!.length + 1) : t;
            name.append(h('span', { 'data-kind': isFact(t) ? 'fact' : 'command', title: t }, label));
          });
          const tail = h('span', {}, h('span', { class: 'console__payload' }, shortPayload(rec.payload)), g.count > 1 ? h('span', { class: 'console__count' }, `×${g.count}`) : null);
          frag.append(h('div', {
            class: `console__row console__row--event${g.count > 1 ? ' console__row--repeat' : ''}`,
            'data-seq': rec.seq, 'data-tone': tone, 'data-input': g.input ? 'true' : null,
            title: g.input ? `input from ${rec.source}` : `from ${rec.source}`,
          }, h('span', {}, time(rec.at)), name, tail));
          if (expandedEvent === rec.seq) frag.append(pre(`#${rec.seq} from ${rec.source}${rec.input ? ' (input)' : ''}\n${prettyJson(rec.payload)}`));
        }
        if (!groups.length) frag.append(empty(copy.none));
        content('events').replaceChildren(frag);
      },

      log() {
        const logs = debug.logs();
        if (!changed('log', [logs.at(-1), logs.length])) return;
        const frag = document.createDocumentFragment();
        for (const l of logs.slice(-rules.logLimit).reverse()) {
          frag.append(h('div', { class: 'console__row console__row--log', 'data-tone': l.level === 'warn' || l.level === 'error' ? l.level : null, 'data-level': l.level },
            h('span', {}, time(l.at)), h('span', {}, `${l.source}: ${l.msg}`), h('span', {}, l.level)));
        }
        if (!logs.length) frag.append(empty(copy.none));
        content('log').replaceChildren(frag);
      },

      modules() {
        const mods = [...debug.modules()].sort((a, b) => a.name.localeCompare(b.name));
        if (!changed('modules', [mods.map((m) => `${m.name}:${m.status}:${m.reason ?? ''}`).join('|'), pickedModule])) return;
        const chips = h('div', { class: 'console__chips' });
        for (const m of mods) {
          chips.append(h('button', {
            class: 'console__chip', type: 'button', 'data-module': m.name, 'data-up': String(m.status === 'started'), 'data-status': m.status,
            'aria-pressed': String(pickedModule === m.name), title: m.reason ? `${m.status}: ${m.reason}` : m.status,
          }, m.name));
        }
        const picked = mods.find((m) => m.name === pickedModule);
        content('modules').replaceChildren(chips, ...(picked ? [h('div', { class: 'console__note', 'data-status': picked.status }, moduleLine(picked))] : []));
      },

      services() {
        const svcs = debug.services();
        if (!changed('services', [svcs.map((x) => `${x.service}:${x.mode}:${x.ok}:${x.checkedAt}:${x.detail}`).join('|')])) return;
        const frag = document.createDocumentFragment();
        for (const x of svcs) {
          frag.append(
            h('div', { class: 'console__row', 'data-tone': x.ok ? null : 'warn' },
              h('span', {}, time(x.checkedAt)), h('span', {}, x.service), h('span', {}, `${x.mode === 'live' ? copy.live : copy.mock} · ${x.ok ? copy.ok : copy.notOk}`)),
            h('div', { class: 'console__detail' }, x.detail),
          );
        }
        if (!svcs.length) frag.append(empty(copy.none));
        content('services').replaceChildren(frag);
      },

      snapshots() {
        if (!changed('snapshots', [snapCount, snapshots.length])) return;
        const frag = document.createDocumentFragment();
        frag.append(h('button', { class: 'console__act', type: 'button', 'data-console-snap': '' }, copy.save));
        for (const { n, snap } of [...snapshots].reverse()) {
          frag.append(h('div', { class: 'console__row console__row--snap', 'data-snapshot': n },
            h('span', {}, time(snap.at)), h('span', {}, `#${n} ${snapSummary(snap)}`),
            h('span', {}, h('button', { class: 'console__act', type: 'button', 'data-console-restore': n }, copy.restore))));
        }
        if (!snapshots.length) frag.append(empty(copy.noSnapshots));
        content('snapshots').replaceChildren(frag);
      },
    };

    function moduleLine(m: ModuleStatus): string {
      const bits = [m.name, m.status];
      if (m.reason) bits.push(m.reason);
      const { owns, provides = [], uses = [] } = m.manifest;
      if (owns.length) bits.push(`owns ${owns.join(', ')}`);
      if (provides.length) bits.push(`provides ${provides.join(', ')}`);
      if (uses.length) bits.push(`uses ${uses.join(', ')}`);
      return bits.join(' · ');
    }

    function snapSummary(snap: Snapshot): string {
      const board = snap.slices.board as BoardState | undefined;
      const nav = snap.slices.nav as NavState | undefined;
      const bits = [nav?.screen, board?.levelId ? `L${board.levelId} ${board.status} ${board.moves} moves` : null].filter(Boolean);
      return bits.length ? bits.join(' · ') : `${Object.keys(snap.slices).length} slices`;
    }

    // ---- command line ----
    const ok = (text: string): Result => ({ text });
    const fail = (text: string): Result => ({ text, tone: 'error' });
    const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

    /** run something that emits, then name the events that followed (run-to-completion makes them synchronous) */
    function withFollowUps(fn: () => string): Result {
      const before = debug.events().at(-1)?.seq ?? 0;
      const text = fn();
      const after = debug.events().filter((e) => e.seq > before).map((e) => e.type);
      if (!after.length) return ok(text);
      const unique = [...new Set(after)];
      const list = unique.slice(0, 6).join(', ') + (unique.length > 6 ? ', …' : '');
      const failed = after.some((t) => /failed$/.test(t));
      return { text: fmt(copy.followed, { result: text, events: list }), tone: failed ? 'error' : after.some((t) => /refused$/.test(t)) ? 'warn' : undefined };
    }

    function save(): number {
      snapCount++;
      snapshots.push({ n: snapCount, snap: debug.snapshot() });
      while (snapshots.length > rules.snapshotLimit) snapshots.shift();
      invalidate('snapshots');
      return snapCount;
    }

    function exec(line: string): Result {
      const { name, args } = parseLine(line);
      const saved = () => snapshots.map((x) => x.n).join(', ') || '—';
      switch (name) {
        case 'help':
          return ok(fmt(copy.help, { commands: Object.keys(debug.commands()).sort().join(' · ') || '—' }));
        case 'state': {
          const all = debug.state();
          if (!args[0]) return ok(Object.keys(all).sort().map((k) => `${k}: ${summarize(all[k], 60)}`).join('\n'));
          if (!(args[0] in all)) return fail(fmt(copy.noSlice, { slice: args[0], slices: Object.keys(all).sort().join(', ') }));
          return ok(prettyJson(all[args[0]]));
        }
        case 'emit': {
          const [type, json] = args;
          if (!type || !/^[a-z][\w-]*:[a-z][\w]*$/.test(type)) return fail(copy.emitUsage);
          let payload: unknown = {};
          if (json) {
            try { payload = JSON.parse(json); } catch (err) { return fail(fmt(copy.badJson, { message: message(err) })); }
          }
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return fail(copy.notObject);
          return withFollowUps(() => { debug.emit(type, payload); return fmt(copy.emitted, { type }); });
        }
        case 'snap':
          return ok(fmt(copy.saved, { n: save() }));
        case 'restore': {
          const n = Number(args[0]);
          if (!args[0] || !Number.isInteger(n)) return fail(fmt(copy.restoreUsage, { saved: saved() }));
          const found = snapshots.find((x) => x.n === n);
          if (!found) return fail(fmt(copy.noSnapshot, { n, saved: saved() }));
          return withFollowUps(() => { debug.restore(found.snap); return fmt(copy.restored, { n }); });
        }
        case 'clear':
          clearedAfter = debug.events().at(-1)?.seq ?? 0;
          expandedEvent = null;
          invalidate('events');
          return ok(copy.cleared);
      }
      const cmd = debug.commands()[name];
      if (!cmd) return fail(fmt(copy.unknown, { name: clip(name, 40) }));
      return withFollowUps(() => resultText(cmd(args), copy.done));
    }

    function print(echo: string, result: Result) {
      out.append(h('div', { class: 'console__line', 'data-tone': result.tone ?? null }, h('b', {}, `› ${echo}`), '\n', h('span', {}, result.text)));
      while (out.childElementCount > OUTPUT_MAX) out.firstElementChild!.remove();
      out.scrollTop = out.scrollHeight;
    }

    function run(raw: string) {
      const line = raw.trim();
      if (!line) return;
      if (ui.history.at(-1) !== line) ui.history = [...ui.history, line].slice(-HISTORY_MAX);
      historyPos = ui.history.length;
      saveUi();
      input.value = '';
      let result: Result;
      try { result = exec(line); } catch (err) {
        result = fail(fmt(copy.failed, { name: parseLine(line).name, message: message(err) }));
        ctx.log.warn(`Console command failed: ${line}`, err);
      }
      print(line, result);
      schedule();
    }

    const off = debug.onChange(schedule);
    render();

    return {
      stop() { off(); root.remove(); },
      debug: () => ({ renders, lastRenderMs, collapsed: ui.collapsed, open: ui.open, snapshots: snapshots.length }),
    };
  },
};
export default consoleModule;
