// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { bootModule } from '../../../test/fake-ctx';
import offline from './index';

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => { vi.unstubAllGlobals(); });

describe('offline', () => {
  test('outside the PWA build it never registers a worker', () => {
    const register = vi.fn();
    vi.stubGlobal('navigator', { onLine: true, serviceWorker: { register, ready: Promise.resolve(), controller: null } });
    const t = bootModule(offline);
    expect(t.state('offline')).toMatchObject({ target: 'test', worker: 'none', online: true });
    expect(register).not.toHaveBeenCalled();
    expect(t.kernel.debug.services()[0]).toMatchObject({ service: 'offline worker', ok: true });
  });

  test('in the PWA build it registers, then says it is ready once', async () => {
    const register = vi.fn().mockResolvedValue({});
    vi.stubGlobal('navigator', { onLine: true, serviceWorker: { register, ready: Promise.resolve({}), controller: null } });
    const t = bootModule(offline, { services: { env: { target: 'pwa', debug: false, buildId: 't', version: '0.0.0-test' } } });
    await flush();
    expect(register).toHaveBeenCalledWith('./sw.js', { scope: './' });
    expect(t.state('offline').worker).toBe('ready');
    expect(t.view!.notices.get('offline-ready')?.text).toBe('Ready to play offline.');
    t.clock.advance(4000);
    expect(t.view!.notices.has('offline-ready')).toBe(false);
  });

  test('a failed registration is reported in plain words and the game keeps going', async () => {
    vi.stubGlobal('navigator', { onLine: true, serviceWorker: { register: vi.fn().mockRejectedValue(new Error('blocked')), ready: new Promise(() => {}), controller: null } });
    const t = bootModule(offline, { services: { env: { target: 'pwa', debug: false, buildId: 't', version: '0.0.0-test' } } });
    await flush();
    expect(t.state('offline')).toMatchObject({ worker: 'error', reason: 'blocked' });
    expect(t.view!.notices.get('offline')?.tone).toBe('warn');
  });

  test('going offline shows a notice; coming back clears it', () => {
    const nav = { onLine: true, serviceWorker: undefined };
    vi.stubGlobal('navigator', nav);
    const t = bootModule(offline);
    nav.onLine = false;
    window.dispatchEvent(new Event('offline'));
    expect(t.state('offline').online).toBe(false);
    expect(t.view!.notices.get('offline')?.text).toMatch(/still works/);
    nav.onLine = true;
    window.dispatchEvent(new Event('online'));
    expect(t.view!.notices.has('offline')).toBe(false);
    expect(t.seen('offline:status_changed', { online: true })).toBeTruthy();
  });
});
