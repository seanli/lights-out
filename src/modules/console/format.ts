// Pure helpers for the console: no DOM, no state.
import { CELL_COUNT, SIZE } from '../../contracts';
import type { EventRecord } from '../../contracts';

/** seconds since the console started, short enough for the time column */
export function fmtTime(at: number, t0: number): string {
  const s = Math.max(0, (at - t0) / 1000);
  if (s < 100) return s.toFixed(3);
  if (s < 6000) {
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
  }
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

/** facts are past tense (board:pressed, offline:status_changed, hints:shown); commands are imperative (board:press) */
export function isFact(type: string): boolean {
  const verb = type.split(':').pop()!.split('_').pop()!;
  return /(ed|shown|done)$/.test(verb);
}

export const isCells = (v: unknown): v is boolean[] =>
  Array.isArray(v) && v.length === CELL_COUNT && v.every((x) => typeof x === 'boolean');

export const litCount = (cells: readonly boolean[]) => cells.reduce((n, c) => n + (c ? 1 : 0), 0);

/** 5 rows of 5 booleans, row-major */
export function boardRows(cells: readonly boolean[]): boolean[][] {
  const rows: boolean[][] = [];
  for (let r = 0; r < SIZE; r++) rows.push(cells.slice(r * SIZE, r * SIZE + SIZE));
  return rows;
}

export const cellName = (i: number) => `r${Math.floor(i / SIZE)} c${i % SIZE}`;

function shortValue(k: string, v: unknown): string | null {
  if (v === undefined) return null;
  if (k === 'index' && typeof v === 'number' && v >= 0 && v < CELL_COUNT) return cellName(v);
  if (k === 'levelId' && typeof v === 'number') return `L${v}`;
  if (isCells(v)) return `${litCount(v)} lit`;
  if (Array.isArray(v)) return `${k}[${v.length}]`;
  if (v && typeof v === 'object') return `${k}{…}`;
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? k : `!${k}`;
  return `${k} ${String(v)}`;
}

export const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** a one-line payload summary, capped (tap the row for the full JSON) */
export function shortPayload(payload: unknown, max = 24): string {
  if (payload === null || payload === undefined) return '';
  if (typeof payload !== 'object') return clip(String(payload), max);
  const parts = Object.entries(payload as Record<string, unknown>).map(([k, v]) => shortValue(k, v)).filter((s): s is string => !!s);
  return clip(parts.join(' '), max);
}

/** a compact one-line summary of a slice: status first, then everything else */
export function summarize(value: unknown, max = 80): string {
  if (value === null || typeof value !== 'object') return clip(JSON.stringify(value) ?? 'undefined', max);
  const entries = Object.entries(value as Record<string, unknown>);
  const status = entries.find(([k]) => k === 'status');
  const parts = [status ? String(status[1]) : null, ...entries.filter(([k]) => k !== 'status').map(([k, v]) => shortValue(k, v))];
  return clip(parts.filter((s): s is string => !!s).join(' · '), max);
}

/** JSON with arrays of plain values kept on one line */
export function prettyJson(value: unknown, indent = ''): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  const next = `${indent}  `;
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (value.every((x) => x === null || typeof x !== 'object')) return `[${value.map((x) => JSON.stringify(x)).join(',')}]`;
    return `[\n${value.map((x) => next + prettyJson(x, next)).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (!entries.length) return '{}';
  return `{\n${entries.map(([k, v]) => `${next}${JSON.stringify(k)}: ${prettyJson(v, next)}`).join(',\n')}\n${indent}}`;
}

export interface EventGroup {
  /** the repeating types, oldest first (one type for a plain run) */
  types: string[];
  /** how many times the run or cycle repeated */
  count: number;
  /** the newest record in the group */
  last: EventRecord;
  /** any record in the group came from outside (a tap, the console) */
  input: boolean;
}

/**
 * Newest first. Consecutive records of the same type collapse into one group with a count;
 * so do short repeating cycles (board:press → board:pressed, tapped 6 times, is one row ×6).
 */
export function groupEvents(records: readonly EventRecord[], limit: number, afterSeq = 0, maxPeriod = 4): EventGroup[] {
  const recent = records.filter((r) => r.seq > afterSeq).slice(-limit).reverse();
  const same = (a: number, b: number) => recent[a]!.type === recent[b]!.type;
  const out: EventGroup[] = [];
  let i = 0;
  while (i < recent.length) {
    let best = { p: 1, k: 1 };
    for (let p = 1; p <= maxPeriod && i + 2 * p <= recent.length; p++) {
      if (p > 1 && new Set(recent.slice(i, i + p).map((r) => r.type)).size < p) continue;
      let k = 1;
      while (i + (k + 1) * p <= recent.length && Array.from({ length: p }, (_, q) => same(i + q, i + k * p + q)).every(Boolean)) k++;
      if (k >= 2 && k * p > best.k * best.p) best = { p, k };
    }
    const size = best.p * best.k;
    const span = recent.slice(i, i + size);
    out.push({
      types: recent.slice(i, i + best.p).map((r) => r.type).reverse(),
      count: best.k,
      last: recent[i]!,
      input: span.some((r) => r.input),
    });
    i += size;
  }
  return out;
}

/** "emit board:press {"index": 3}" keeps the JSON whole; everything else splits on spaces */
export function parseLine(line: string): { name: string; args: string[] } {
  const m = /^(\S+)\s*([\s\S]*)$/.exec(line.trim());
  if (!m) return { name: '', args: [] };
  const name = m[1]!;
  const rest = m[2]!.trim();
  if (name === 'emit') {
    const t = /^(\S+)\s*([\s\S]*)$/.exec(rest);
    if (!t) return { name, args: [] };
    return { name, args: t[2]!.trim() ? [t[1]!, t[2]!.trim()] : [t[1]!] };
  }
  return { name, args: rest ? rest.split(/\s+/) : [] };
}

/** a command result as text */
export function resultText(value: unknown, done: string): string {
  if (value === undefined || value === null || value === true) return done;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return prettyJson(value);
  return String(value);
}
