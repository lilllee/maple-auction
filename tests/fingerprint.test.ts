import { describe, expect, test } from 'vitest';
import type { Listing } from '../src/nexon/listing.js';
import { fingerprint, topN } from '../src/watch/fingerprint.js';

const emptyListing: Listing = {
  tradeSn: '', itemName: '', pricePerItem: 0, quantity: 1,
  starforce: null, potentialGrade: null, potentialLines: [],
  additionalGrade: null, additionalLines: [], remainUpgradeCount: null,
  extras: [],
};
const L = (sn: string, p: number): Listing => ({ ...emptyListing, tradeSn: sn, pricePerItem: p });

describe('topN', () => {
  test('topN은 가격순, 동가면 tradeSn순', () => {
    expect(topN([L('b', 10), L('a', 10), L('c', 5), L('d', 20)], 3).map(l => l.tradeSn)).toEqual(['c', 'a', 'b']);
  });
  test('입력 배열을 변경하지 않는다', () => {
    const input = [L('b', 10), L('a', 5)];
    topN(input, 2);
    expect(input.map(l => l.tradeSn)).toEqual(['b', 'a']);
  });
});

describe('fingerprint', () => {
  test('fingerprint', () => {
    expect(fingerprint([])).toBe('');
    expect(fingerprint([L('c', 5), L('a', 10)])).toBe('c:5|a:10');
    expect(fingerprint([L('a', 10), L('c', 5)])).not.toBe(fingerprint([L('c', 5), L('a', 10)]));
  });
});
