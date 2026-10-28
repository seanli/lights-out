import { expect, test } from 'vitest';
import { fmt } from './dom';

test('fmt fills names, picks singular or plural, and leaves unknown names visible', () => {
  expect(fmt('{moves} {moves|tap|taps} · par {par}', { moves: 1, par: 3 })).toBe('1 tap · par 3');
  expect(fmt('{moves} {moves|tap|taps}', { moves: 4 })).toBe('4 taps');
  expect(fmt('{missing} and {x|a|b}', {})).toBe('{missing} and {x|a|b}');
});
