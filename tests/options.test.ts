import { expect, test } from 'vitest';
import {
  ADDITIONAL_POTENTIAL_OPTIONS,
  POTENTIAL_OPTIONS,
  WORLDS,
  findGradeCode,
  findOptionCode,
  findWorldId,
} from '../src/nexon/options.js';

test('표 크기', () => {
  expect(POTENTIAL_OPTIONS).toHaveLength(39);
  expect(ADDITIONAL_POTENTIAL_OPTIONS).toHaveLength(36);
  expect(WORLDS).toHaveLength(18);
});

test('라벨 공백 차이를 무시하고 코드를 찾는다', () => {
  expect(findOptionCode('STR  %증가 ', POTENTIAL_OPTIONS)).toBe('strPercent');
  expect(findOptionCode('스킬 재사용 대기시간 감소', POTENTIAL_OPTIONS)).toBe('skillCooldownReduction');
  expect(findOptionCode('캐릭터 9레벨 당 STR 증가', POTENTIAL_OPTIONS)).toBeNull();
  expect(findOptionCode('캐릭터 9레벨 당 STR 증가', ADDITIONAL_POTENTIAL_OPTIONS)).toBe('strPerLevel');
});

test('등급 별칭', () => {
  expect(findGradeCode('레전드리')).toBe('legendary');
  expect(findGradeCode('레전더리')).toBe('legendary');
  expect(findGradeCode('전체')).toBe('all');
  expect(findGradeCode('신화')).toBeNull();
});

test('월드', () => {
  expect(findWorldId('스카니아')).toBe(0);
  expect(findWorldId('챌린저스4')).toBe(54);
  expect(findWorldId('없는월드')).toBeNull();
});
