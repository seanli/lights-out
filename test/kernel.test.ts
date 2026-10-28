import { describe, expect, test } from 'vitest';
import * as v from 'valibot';
import type { ModuleDef } from '../src/contracts';
import { createFakeClock, createKernel, DataError, replay } from '../src/kernel';

const mod = (m: Partial<ModuleDef['manifest']> & { name: string }, init: ModuleDef['init']): ModuleDef => ({
  manifest: { emits: [], listens: [], owns: [], ...m },
  init,
});

describe('kernel', () => {
  test('a command emitted inside a handler runs after the current event finishes', () => {
    const order: string[] = [];
    const k = createKernel({ data: {} });
    k.register(mod({ name: 'a', listens: ['board:press', 'board:undo'], emits: ['board:undo'] }, (ctx) => {
      ctx.on('board:press', () => { order.push('a:press:start'); ctx.emit('board:undo', {}); order.push('a:press:end'); });
      ctx.on('board:undo', () => order.push('a:undo'));
    }));
    k.register(mod({ name: 'b', listens: ['board:press'] }, (ctx) => { ctx.on('board:press', () => order.push('b:press')); }));
    k.boot();
    k.emit('board:press', { index: 0 });
    expect(order).toEqual(['a:press:start', 'a:press:end', 'b:press', 'a:undo']);
  });

  test('only the owner may write a slice; values are frozen plain data', () => {
    const k = createKernel({ data: {} });
    let err = '';
    k.register(mod({ name: 'nav', owns: ['nav'] }, (ctx) => { ctx.write('nav', { screen: 'home', sheet: null }); }));
    k.register(mod({ name: 'intruder', deps: ['nav'] }, (ctx) => {
      try { ctx.write('nav', { screen: 'play', sheet: null }); } catch (e) { err = (e as Error).message; }
      expect(Object.isFrozen(ctx.read('nav'))).toBe(true);
    }));
    k.boot();
    expect(err).toMatch(/owned by nav/);
    expect(k.read('nav')).toEqual({ screen: 'home', sheet: null });
  });

  test('bad data fails loudly before any module inits, naming file, module and field', () => {
    let inited = false;
    const k = createKernel({ data: { rules: { levels: { count: 'fifty' } } } });
    k.register({ manifest: { name: 'levels', emits: [], listens: [], owns: [], data: { rules: v.object({ count: v.number() }) } }, init: () => { inited = true; } });
    let problems: string[] = [];
    try { k.boot(); } catch (e) { expect(e).toBeInstanceOf(DataError); problems = (e as DataError).problems; }
    expect(problems[0]).toMatch(/rules\.json → levels\.count/);
    expect(inited).toBe(false);
  });

  test('a module whose required service is missing is skipped, not crashed', () => {
    const k = createKernel({ data: {} });
    k.register(mod({ name: 'hints', uses: ['solver'] }, () => {}));
    const r = k.boot();
    expect(r.skipped).toEqual([{ name: 'hints', reason: 'needs the solver service, which nothing provides' }]);
  });

  test('providers init before users regardless of registration order', () => {
    const order: string[] = [];
    const k = createKernel({ data: {} });
    k.register(mod({ name: 'a-user', uses: ['solver'] }, (ctx) => { order.push('user'); ctx.need('solver'); }));
    k.register(mod({ name: 'z-provider', provides: ['solver'] }, (ctx) => { order.push('provider'); ctx.provide('solver', {} as never); }));
    k.boot();
    expect(order).toEqual(['provider', 'user']);
  });

  test('a throwing handler is logged and reported; other handlers still run', () => {
    const ran: string[] = [];
    const k = createKernel({ data: {} });
    k.register(mod({ name: 'bad', listens: ['board:press'] }, (ctx) => { ctx.on('board:press', () => { throw new Error('boom'); }); }));
    k.register(mod({ name: 'good', listens: ['board:press'] }, (ctx) => { ctx.on('board:press', () => ran.push('good')); }));
    k.boot();
    k.emit('board:press', { index: 1 });
    expect(ran).toEqual(['good']);
    const failed = k.debug.events().find((e) => e.type === 'kernel:handler_failed');
    expect(failed?.payload).toMatchObject({ module: 'bad', type: 'board:press', message: 'boom' });
  });

  test('watchers run after the event completes, with consistent state', () => {
    const seen: unknown[] = [];
    const k = createKernel({ data: {} });
    k.register(mod({ name: 'nav', owns: ['nav'], listens: ['nav:go'] }, (ctx) => {
      ctx.write('nav', { screen: 'home', sheet: null });
      ctx.on('nav:go', ({ screen }) => { ctx.write('nav', { screen, sheet: null }); ctx.write('nav', { screen, sheet: 'solved' }); });
    }));
    k.register(mod({ name: 'viewer', deps: ['nav'] }, (ctx) => { ctx.watch('nav', (n) => seen.push(n)); }));
    k.boot();
    k.emit('nav:go', { screen: 'play' });
    expect(seen).toEqual([{ screen: 'play', sheet: 'solved' }]);
  });

  test('runtime failures reach onFault once per module, and start() failures are reported', () => {
    const faults: string[] = [];
    const k = createKernel({ data: {}, onFault: (f) => faults.push(`${f.module}:${f.kind}`) });
    k.register(mod({ name: 'bad', listens: ['board:press'] }, (ctx) => { ctx.on('board:press', () => { throw new Error('boom'); }); }));
    k.register(mod({ name: 'late' }, () => ({ start() { throw new Error('nope'); } })));
    const r = k.boot();
    k.emit('board:press', { index: 1 });
    k.emit('board:press', { index: 2 });
    expect(faults).toEqual(['late:start', 'bad:handler']);
    expect(r.failed).toEqual([{ name: 'late', reason: 'nope' }]);
  });

  test('undeclared events produce a warning', () => {
    const k = createKernel({ data: {} });
    k.register(mod({ name: 'sloppy' }, (ctx) => { ctx.emit('board:undo', {}); }));
    k.boot();
    expect(k.debug.logs().some((l) => l.level === 'warn' && /doesn't declare/.test(l.msg))).toBe(true);
  });

  test('state must be plain data', () => {
    const k = createKernel({ data: {} });
    k.register(mod({ name: 'nav', owns: ['nav'] }, (ctx) => { ctx.write('nav', { screen: 'home', sheet: null, timer: () => 1 } as never); }));
    const r = k.boot();
    expect(r.failed[0]?.reason).toMatch(/plain data/);
  });

  test('snapshot plus input log replays to the same state', () => {
    const counter = mod({ name: 'nav', owns: ['nav'], listens: ['nav:go'] }, (ctx) => {
      ctx.write('nav', { screen: 'home', sheet: null });
      ctx.on('nav:go', ({ screen }) => ctx.write('nav', { screen, sheet: null }));
    });
    const k = createKernel({ data: {}, clock: createFakeClock(), seed: 7 });
    k.register(counter);
    k.boot();
    k.emit('nav:go', { screen: 'play' });
    k.emit('nav:go', { screen: 'home' });
    k.emit('nav:go', { screen: 'play' });
    const again = replay(k.session(), [counter], {});
    expect(again.read('nav')).toEqual(k.read('nav'));
    expect(k.session().inputs.map((i) => i.type)).toEqual(['nav:go', 'nav:go', 'nav:go']);
  });
});
