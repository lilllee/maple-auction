import fs from 'node:fs';
import { describe, expect, test } from 'vitest';
import { listingsFromResponse, normalizeListing } from '../src/nexon/listing.js';

const resp = JSON.parse(fs.readFileSync('tests/fixtures/search-response.json', 'utf8'));

describe('normalizeListing', () => {
  test('fixture의 매물을 정규화한다', () => {
    const list = listingsFromResponse(resp);
    expect(list.length).toBe(resp.items.length);
    const first = list[0];
    expect(first.tradeSn).toBe(String(resp.items[0].tradeSn));
    expect(first.itemName).toBe('에테르넬 나이트헬름');
    expect(first.pricePerItem).toBe(3400000000);
    expect(first.potentialGrade).toBe('레전드리');
    expect(first.potentialLines).toContain('스킬 재사용 대기시간 -2초');
    expect(first.potentialLines).toContain('STR +10%');
    expect(first.additionalGrade).toBeNull();
    expect(first.additionalLines).toEqual([]);
    expect(first.starforce).toBe(0);
    expect(first.remainUpgradeCount).toBe(12);
    expect(first.extras).toEqual([]);
  });

  test('에디셔널 잠재능력을 읽는다', () => {
    const third = listingsFromResponse(resp)[2];
    expect(third.additionalGrade).toBe('레어');
    expect(third.additionalLines.length).toBe(3);
  });

  test('툴팁이 비어 있어도 안전한 기본값', () => {
    const l = normalizeListing({ tradeSn: 1, pricePerItem: 5, quantity: 1 });
    expect(l).toMatchObject({
      tradeSn: '1', pricePerItem: 5, itemName: '', starforce: null, potentialGrade: null,
      potentialLines: [], additionalGrade: null, additionalLines: [], remainUpgradeCount: null, extras: [],
    });
    expect(JSON.stringify(l)).not.toContain('undefined');
  });

  test('객체가 아닌 입력은 기본 매물', () => {
    const l = normalizeListing(null);
    expect(l).toMatchObject({ tradeSn: '', itemName: '', pricePerItem: 0, quantity: 1 });
    expect(JSON.stringify(l)).not.toContain('undefined');
  });

  test('숫자가 아닌 가격은 0', () => {
    expect(normalizeListing({ pricePerItem: '12abc' }).pricePerItem).toBe(0);
  });

  test('items가 없으면 빈 배열', () => {
    expect(listingsFromResponse(null)).toEqual([]);
    expect(listingsFromResponse({})).toEqual([]);
  });
});
