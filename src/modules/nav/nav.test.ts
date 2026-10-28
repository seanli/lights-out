import { describe, expect, test } from 'vitest';
import { bootModule } from '../../../test/fake-ctx';
import nav from './index';

describe('nav', () => {
  test('starts on home with no sheet', () => {
    const t = bootModule(nav);
    expect(t.state('nav')).toEqual({ screen: 'home', sheet: null });
  });

  test('a started level shows the play screen and closes sheets', () => {
    const t = bootModule(nav);
    t.emit('nav:open_sheet', { sheet: 'solved' });
    t.emit('levels:started', { levelId: 3, par: 2, count: 50 });
    expect(t.state('nav')).toEqual({ screen: 'play', sheet: null });
    expect(t.seen('nav:changed', { screen: 'play' })).toBeTruthy();
  });

  test('sheets open over the current screen; no-op changes emit nothing', () => {
    const t = bootModule(nav);
    t.emit('nav:go', { screen: 'play' });
    t.emit('nav:open_sheet', { sheet: 'solved' });
    expect(t.state('nav')).toEqual({ screen: 'play', sheet: 'solved' });
    const before = t.all('nav:changed').length;
    t.emit('nav:open_sheet', { sheet: 'solved' });
    expect(t.all('nav:changed').length).toBe(before);
    t.emit('nav:close_sheet', {});
    expect(t.state('nav').sheet).toBeNull();
  });
});
