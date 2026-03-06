'use strict';

const { toFiniteNumber } = require('../lib/services/number-utils');

describe('number utils', () => {
  test('toFiniteNumber returns parsed numeric values', () => {
    expect(toFiniteNumber('42', 0)).toBe(42);
    expect(toFiniteNumber(5.5, 0)).toBe(5.5);
  });

  test('toFiniteNumber falls back for NaN/infinite inputs', () => {
    expect(toFiniteNumber('abc', 7)).toBe(7);
    expect(toFiniteNumber(undefined, 7)).toBe(7);
    expect(toFiniteNumber(Infinity, 7)).toBe(7);
  });
});
