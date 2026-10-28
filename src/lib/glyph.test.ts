// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { roomGlyph } from './glyph';

const cross = { shape: { cols: 3, rows: 3, mask: [false, true, false, true, true, true, false, true, false] }, count: 4 };

describe('roomGlyph', () => {
  it('draws one dot per grid slot, gaps empty', () => {
    const g = roomGlyph(cross, 0);
    expect(g.children).toHaveLength(9);
    expect(g.querySelectorAll('[data-gap]')).toHaveLength(4);
    expect(g.querySelectorAll('[data-lit="true"]')).toHaveLength(0);
  });
  it('lights the solved share from the centre out', () => {
    const half = roomGlyph(cross, 2);
    expect(half.querySelectorAll('[data-lit="true"]')).toHaveLength(3); // round(5 * 2/4)
    expect(half.children[4].getAttribute('data-lit')).toBe('true');
    expect(roomGlyph(cross, 9).querySelectorAll('[data-lit="true"]')).toHaveLength(5);
  });
  it('sizes dots by the longer side, so a big square is fine dots in the same box', () => {
    const g = roomGlyph({ shape: { cols: 10, rows: 10, mask: null }, count: 30 }, 0);
    expect(g.children).toHaveLength(100);
    expect(g.style.getPropertyValue('--cols')).toBe('10');
    expect(g.style.getPropertyValue('--n')).toBe('10');
    expect(g.hasAttribute('data-tall')).toBe(false);
  });
  it('a tower (twice as tall as wide or more) keeps its proportions: 5 columns, sized by its 16 rows, marked tall', () => {
    const g = roomGlyph({ shape: { cols: 5, rows: 16, mask: null }, count: 30 }, 15);
    expect(g.children).toHaveLength(80);
    expect(g.style.getPropertyValue('--cols')).toBe('5');
    expect(g.style.getPropertyValue('--n')).toBe('16');
    expect(g.dataset.tall).toBe('true');
    expect(g.querySelectorAll('[data-lit="true"]')).toHaveLength(40);
    expect(roomGlyph({ shape: { cols: 5, rows: 6, mask: null }, count: 40 }, 0).hasAttribute('data-tall')).toBe(false);
  });
});
