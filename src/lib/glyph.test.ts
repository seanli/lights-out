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
});
