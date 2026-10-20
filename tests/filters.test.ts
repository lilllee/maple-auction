import fs from 'node:fs';
import { expect, test } from 'vitest';
import { loadConfig, readEnvFile, type SearchSpec } from '../src/config.js';
import { SORT_PRICE_PER_ITEM_ASC, buildSearchRequest } from '../src/nexon/filters.js';

const fixture = JSON.parse(fs.readFileSync('tests/fixtures/search-request.json', 'utf8'));
const spec = loadConfig({ ...readEnvFile('.env.example'), KAKAO_REST_API_KEY: 'dummy' }).search;
const sel = {
  accountId: fixture.accountId, worldId: fixture.worldId, characterId: fixture.characterId,
  worldName: '', characterName: '',
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const build = (s: SearchSpec, opts?: { page?: number; limit?: number }): any => buildSearchRequest(s, sel, opts);

test('예시 조건으로 만든 본문이 캡처한 본문과 같다', () => {
  expect(buildSearchRequest(spec, sel)).toEqual({ ...fixture, saveRecentKeyword: false });
  expect(JSON.stringify(buildSearchRequest(spec, sel))).toBe(JSON.stringify(fixture));
});

test('합산을 끄면 optionRows가 개별 옵션 형태로 들어간다', () => {
  const body = build({ ...spec, potentialSum: false });
  expect(JSON.stringify(body)).not.toContain('potentialOptionSum');
  expect(body.filters.enhancementOption.potentialOptions).toEqual([
    { skillCooldownReduction: 2 }, { strPercent: 9 },
  ]);
});

test('page와 limit 옵션', () => {
  const body = build(spec, { page: 2 });
  expect(body.page).toBe(2);
  expect(body.limit).toBe(20);
  expect(body.sortType).toBe(SORT_PRICE_PER_ITEM_ASC);
  expect(build(spec, { limit: 5 }).limit).toBe(5);
});

test('exactMatch가 false이면 키를 생략한다', () => {
  expect('exactMatch' in build({ ...spec, exactMatch: false }).filters).toBe(false);
});

test('priceMax는 price.max로 들어가고 null이면 price 키가 없다', () => {
  expect(build({ ...spec, priceMax: 5000 }).filters.price).toEqual({ max: 5000 });
  expect('price' in build(spec).filters).toBe(false);
});

test('스타포스 최소/최대', () => {
  const eo = build({ ...spec, starforceMin: 17, starforceMax: 22 }).filters.enhancementOption;
  expect(eo.starforceMin).toBe(17);
  expect(eo.starforceMax).toBe(22);
  const eo2 = build({ ...spec, starforceMin: 0 }).filters.enhancementOption;
  expect(eo2.starforceMin).toBe(0);
  expect('starforceMax' in eo2).toBe(false);
});

test('에디셔널 합산 형태', () => {
  const eo = build({
    ...spec,
    potentialGrade: 'all', potentialOptions: [],
    additionalPotentialGrade: 'epic', additionalPotentialSum: true,
    additionalPotentialOptions: [{ code: 'strPercent', label: 'STR %증가', min: 4 }],
  }).filters.enhancementOption;
  expect(eo).toEqual({ additionalPotentialGrade: 2, additionalPotentialOptionSum: { strPercent: 4 } });
});

test('불리언 옵션 코드는 true를 보낸다', () => {
  const eo = build({
    ...spec, potentialSum: true,
    potentialOptions: [{ code: 'hasteSkill', label: '<쓸만한 헤이스트> 스킬', min: 1 }],
  }).filters.enhancementOption;
  expect(eo.potentialOptionSum).toEqual({ hasteSkill: true });
});

test('조건이 비면 enhancementOption을 생략하고 undefined/null이 없다', () => {
  const empty = build({ ...spec, potentialGrade: 'all', potentialOptions: [] });
  expect('enhancementOption' in empty.filters).toBe(false);
  const json = JSON.stringify(buildSearchRequest(spec, sel));
  expect(json).not.toContain('undefined');
  expect(json).not.toContain('null');
});

test('분류는 itemCategory로 들어간다', () => {
  expect(build({ ...spec, itemCategory: 'WEAPON' }).filters.itemCategory).toEqual({ itemDetailCategory: 'WEAPON' });
});
