// Pure progress rules: stars, unlocking, and reading a save (validate → migrate → salvage).
import * as v from 'valibot';
import { LevelResultSchema, ProgressSaveV1Schema, type LevelResult, type Pack, type ProgressSave, type ProgressState, type Scoring, type Stars } from '../../contracts';

export const freshSave = (): ProgressSave => ({ version: 1, results: {}, pendingHints: {}, lastLevel: 0 });

/** moves vs par sets the tier; each hint costs hintCost stars; never below minStars */
export function starsFor(moves: number, par: number, hintsUsed: number, s: Scoring): Stars {
  const over = moves - par;
  const base = over <= s.threeStarsWithin ? 3 : over <= s.twoStarsWithin ? 2 : 1;
  return Math.min(3, Math.max(s.minStars, base - hintsUsed * s.hintCost)) as Stars;
}

/**
 * Classic path: highest solved classic level + 1 (at least 1), capped at the classic count when it is known.
 * Only ids 1..count are classic (Variety rooms use ids from 1001 up), so room results never move it.
 */
export function unlockedFrom(save: ProgressSave, count?: number): number {
  let top = 0;
  for (const k of Object.keys(save.results)) {
    const id = Number(k) || 0;
    if (count && count > 0 && id > count) continue;
    top = Math.max(top, id);
  }
  const next = top + 1;
  return count && count > 0 ? Math.min(next, count) : next;
}

export type PackProgress = NonNullable<ProgressState['packs']>[string];

/** per Variety room: highest solved index + 1 (at least 1, capped at its count), levels solved, stars earned */
export function packProgress(save: ProgressSave, packs: readonly Pack[]): Record<string, PackProgress> {
  const out: Record<string, PackProgress> = {};
  for (const p of packs) {
    if (p.kind === 'classic') continue;
    let top = 0, solved = 0, stars = 0;
    for (let index = 1; index <= p.count; index++) {
      const r = save.results[String(p.first + index - 1)];
      if (!r) continue;
      top = index;
      solved++;
      stars += r.stars;
    }
    out[p.id] = { unlockedUpTo: Math.max(1, Math.min(top + 1, p.count)), solved, stars };
  }
  return out;
}

/** One step per old version: steps[n] turns a version-n save into version n+1. None yet. */
export type Migrations = Readonly<Record<number, (old: Record<string, unknown>) => unknown>>;
export const MIGRATIONS: Migrations = Object.freeze({});

/** an older save brought up to the current shape, or null if no migration applies */
export function migrate(raw: unknown, steps: Migrations = MIGRATIONS): ProgressSave | null {
  let cur = raw;
  let moved = false;
  for (let i = 0; i < 20; i++) {
    if (!cur || typeof cur !== 'object') return null;
    const ver = (cur as { version?: unknown }).version;
    const step = typeof ver === 'number' ? steps[ver] : undefined;
    if (!step) break;
    cur = step(cur as Record<string, unknown>);
    moved = true;
  }
  if (!moved) return null;
  const parsed = v.safeParse(ProgressSaveV1Schema, cur);
  return parsed.success ? parsed.output : null;
}

const LevelKey = /^[1-9]\d*$/;
const HintCount = v.pipe(v.number(), v.integer(), v.minValue(0));

/** keep every level result that still reads correctly from a damaged save */
export function salvage(raw: unknown): { save: ProgressSave; kept: number } {
  const save = freshSave();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { save, kept: 0 };
  const r = raw as Record<string, unknown>;
  const results: Record<string, LevelResult> = {};
  const pendingHints: Record<string, number> = {};
  if (r.results && typeof r.results === 'object') {
    for (const [k, val] of Object.entries(r.results)) {
      const p = v.safeParse(LevelResultSchema, val);
      if (LevelKey.test(k) && p.success) results[k] = p.output;
    }
  }
  if (r.pendingHints && typeof r.pendingHints === 'object') {
    for (const [k, val] of Object.entries(r.pendingHints)) if (LevelKey.test(k) && v.is(HintCount, val)) pendingHints[k] = val;
  }
  const lastLevel = typeof r.lastLevel === 'number' && Number.isInteger(r.lastLevel) && r.lastLevel >= 0 ? r.lastLevel : 0;
  return { save: { ...save, results, pendingHints, lastLevel }, kept: Object.keys(results).length };
}

export type Loaded =
  | { source: 'new'; save: ProgressSave }
  | { source: 'saved'; save: ProgressSave; migrated: boolean }
  | { source: 'recovered'; save: ProgressSave; kept: number }
  /** written by a newer build: readable parts are shown, but the stored value must never be overwritten */
  | { source: 'newer'; save: ProgressSave; version: number };

/** what a stored value means: nothing, a good save, an old save, or damage */
export function readSave(raw: unknown, steps: Migrations = MIGRATIONS): Loaded {
  if (raw === undefined) return { source: 'new', save: freshSave() };
  const parsed = v.safeParse(ProgressSaveV1Schema, raw);
  if (parsed.success) return { source: 'saved', save: parsed.output, migrated: false };
  const version = raw && typeof raw === 'object' ? (raw as { version?: unknown }).version : undefined;
  if (typeof version === 'number' && version > ProgressSaveV1Schema.entries.version.literal) {
    return { source: 'newer', save: salvage(raw).save, version };
  }
  const migrated = migrate(raw, steps);
  if (migrated) return { source: 'saved', save: migrated, migrated: true };
  return { source: 'recovered', ...salvage(raw) };
}

/**
 * Combine this tab's save with what another tab may have stored since: nothing earned anywhere is lost.
 * Per level: most stars, fewest moves, first solve time. Pending hints from the other tab count only for
 * levels neither copy has solved.
 */
export function mergeSaves(ours: ProgressSave, theirs: ProgressSave): ProgressSave {
  const results: Record<string, LevelResult> = { ...theirs.results };
  for (const [k, r] of Object.entries(ours.results)) {
    const t = results[k];
    results[k] = t
      ? { stars: (t.stars > r.stars ? t.stars : r.stars), bestMoves: Math.min(t.bestMoves, r.bestMoves), solvedAt: Math.min(t.solvedAt, r.solvedAt) }
      : r;
  }
  const pendingHints: Record<string, number> = { ...ours.pendingHints };
  for (const [k, n] of Object.entries(theirs.pendingHints)) {
    if (ours.results[k] || results[k]) continue;
    pendingHints[k] = Math.max(pendingHints[k] ?? 0, n);
  }
  for (const k of Object.keys(pendingHints)) if (results[k] && !ours.pendingHints[k]) delete pendingHints[k];
  return { version: 1, results, pendingHints, lastLevel: ours.lastLevel };
}
