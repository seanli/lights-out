// @vitest-environment happy-dom
// Boots every discovered module with the LIVE data, then proves deleting any one module breaks nothing.
import { describe, expect, test } from 'vitest';
import type { ModuleDef } from '../src/contracts';
import { createFakeClock, createKernel } from '../src/kernel';
import { discoverModules, liveData } from '../src/shell/registry';
import { createFakeView, createMemoryStorage } from './fake-ctx';

function bootWith(modules: ModuleDef[]) {
  document.body.replaceChildren();
  const k = createKernel({ data: liveData, seed: 3, clock: createFakeClock() });
  k.provide('view', createFakeView());
  k.provide('env', { target: 'test', debug: true, buildId: 'test' });
  // storage normally comes from the storage module; provide a fallback only if it's absent
  if (!modules.some((m) => (m.manifest.provides ?? []).includes('storage'))) k.provide('storage', createMemoryStorage());
  modules.forEach((m) => k.register(m));
  const report = k.boot();
  return { k, report };
}

const all = discoverModules();

describe('whole game', () => {
  test('discovers modules from their folders', () => {
    expect(all.length).toBeGreaterThan(0);
    for (const m of all) expect(m.manifest.name).toMatch(/^[a-z][a-z-]*$/);
  });

  test('every module boots with the live data; no data section is orphaned', () => {
    const { report } = bootWith(all);
    expect(report.failed).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(report.orphans).toEqual([]);
  });

  test('no two modules claim the same slice or service', () => {
    const slices = all.flatMap((m) => m.manifest.owns);
    const services = all.flatMap((m) => m.manifest.provides ?? []);
    expect(new Set(slices).size).toBe(slices.length);
    expect(new Set(services).size).toBe(services.length);
  });

  test.each(all.map((m) => [m.manifest.name]))('removing %s breaks nothing', (name) => {
    const rest = all.filter((m) => m.manifest.name !== name);
    const { k, report } = bootWith(rest);
    expect(report.failed).toEqual([]);
    // modules that genuinely need the removed one's service are skipped with a plain reason
    for (const s of report.skipped) expect(s.reason).toMatch(/needs the /);
    // poke the main journey; nothing may throw
    expect(() => {
      k.emit('levels:start', { levelId: 1 });
      k.emit('board:press', { index: 12 });
      k.emit('hints:request', {});
      k.emit('board:undo', {});
      k.emit('board:restart', {});
      k.emit('nav:go', { screen: 'home' });
    }).not.toThrow();
    expect(k.debug.events().filter((e) => e.type === 'kernel:handler_failed')).toEqual([]);
  });
});
