import { describe, expect, test } from 'vitest';
import { CLASSIC_SHAPE } from '../contracts/entities';
import { cellCount, cellIndexes, fitsShape, isCell, parseShape, pressTargets, sameShape, shapeKey } from './shape';

describe('shape helpers', () => {
  const ring = parseShape(['XXXXXXX', 'XXXXXXX', 'XX...XX', 'XX...XX', 'XX...XX', 'XXXXXXX', 'XXXXXXX']);

  test('classic presses are a clipped plus', () => {
    expect(pressTargets(CLASSIC_SHAPE, 12).sort((a, b) => a - b)).toEqual([7, 11, 12, 13, 17]);
    expect(pressTargets(CLASSIC_SHAPE, 0).sort((a, b) => a - b)).toEqual([0, 1, 5]);
  });

  test('gaps are not cells, are never toggled, and block presses', () => {
    expect(cellCount(ring)).toBe(40);
    expect(isCell(ring, 24)).toBe(false);
    expect(pressTargets(ring, 24)).toEqual([]);
    // (2,1) sits beside the gap at (2,2): the press doesn't reach into it
    expect(pressTargets(ring, 15).sort((a, b) => a - b)).toEqual([8, 14, 15, 22]);
    expect(cellIndexes(ring)).not.toContain(16);
  });

  test('fitsShape rejects wrong sizes and lit gaps', () => {
    const blank = new Array(49).fill(false);
    expect(fitsShape(ring, blank)).toBe(true);
    expect(fitsShape(ring, blank.map((_, i) => i === 24))).toBe(false);
    expect(fitsShape(CLASSIC_SHAPE, blank)).toBe(false);
  });

  test('a full picture parses to a plain rectangle; keys are stable', () => {
    expect(parseShape(['XXXX', 'XXXX', 'XXXX', 'XXXX'])).toEqual({ cols: 4, rows: 4, mask: null });
    expect(shapeKey(CLASSIC_SHAPE)).toBe('5x5');
    expect(sameShape(undefined, CLASSIC_SHAPE)).toBe(true);
    expect(sameShape(ring, CLASSIC_SHAPE)).toBe(false);
    expect(() => parseShape(['XX', 'X'])).toThrow(/same length|at least 3/);
  });
});
