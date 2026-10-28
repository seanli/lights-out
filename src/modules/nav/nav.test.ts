import { describe, expect, test } from 'vitest';
import { bootModule } from '../../../test/fake-ctx';
import nav from './index';

describe('nav', () => {
  test('starts on home with no sheet', () => {
    const t = bootModule(nav);
    expect(t.state('nav')).toEqual({ screen: 'home', sheet: null, previous: null });
  });

  test('a started level shows the play screen and closes sheets', () => {
    const t = bootModule(nav);
    t.emit('nav:open_sheet', { sheet: 'solved' });
    t.emit('levels:started', { levelId: 3, par: 2, count: 50 });
    expect(t.state('nav')).toMatchObject({ screen: 'play', sheet: null });
    expect(t.seen('nav:changed', { screen: 'play' })).toBeTruthy();
  });

  test('sheets open over the current screen; no-op changes emit nothing', () => {
    const t = bootModule(nav);
    t.emit('nav:go', { screen: 'play' });
    t.emit('nav:open_sheet', { sheet: 'solved' });
    expect(t.state('nav')).toMatchObject({ screen: 'play', sheet: 'solved' });
    const before = t.all('nav:changed').length;
    t.emit('nav:open_sheet', { sheet: 'solved' });
    expect(t.all('nav:changed').length).toBe(before);
    t.emit('nav:close_sheet', {});
    expect(t.state('nav').sheet).toBeNull();
  });

  test('back returns to the screen you came from, else home', () => {
    const t = bootModule(nav);
    t.emit('levels:started', { levelId: 4, par: 3, count: 50 });
    t.emit('nav:go', { screen: 'learn' });
    t.emit('nav:back', {});
    expect(t.state('nav').screen).toBe('play');
    t.emit('nav:back', {});
    expect(t.state('nav').screen).toBe('home');
  });

  test('back walks the whole trail: a level opened from a board returns there even after a trip to Learn', () => {
    const t = bootModule(nav);
    t.emit('nav:go', { screen: 'variety' });
    t.emit('levels:started', { levelId: 5001, par: 2, count: 12, pack: 'ring', index: 1, next: 5002 });
    t.emit('nav:go', { screen: 'learn' });
    const back = () => { t.emit('nav:back', {}); return t.state('nav'); };
    expect(back()).toMatchObject({ screen: 'play', previous: 'variety' });
    expect(back()).toMatchObject({ screen: 'variety', previous: 'home' });
    expect(back()).toMatchObject({ screen: 'home', previous: null });
    expect(back()).toMatchObject({ screen: 'home', previous: null });
  });

  test('going to a screen already on the trail drops what came after it', () => {
    const t = bootModule(nav);
    t.emit('nav:go', { screen: 'variety' });
    t.emit('levels:started', { levelId: 5001, par: 2, count: 12, pack: 'ring', index: 1, next: 5002 });
    t.emit('nav:go', { screen: 'variety' }); // the solved sheet's "Levels"
    expect(t.state('nav')).toMatchObject({ screen: 'variety', previous: 'home' });
    t.emit('nav:go', { screen: 'home' });
    expect(t.state('nav')).toMatchObject({ screen: 'home', previous: null });
  });
});
