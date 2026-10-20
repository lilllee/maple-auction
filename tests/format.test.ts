import { expect, test } from 'vitest';
import { loadConfig, readEnvFile } from '../src/config.js';
import {
  BUY_PAGE_URL,
  MAX_TEXT_LENGTH,
  formatFailureMessage,
  formatLimitMessage,
  formatListingMessage,
  formatLoginRequiredMessage,
  formatMeso,
  formatNoResultsMessage,
  formatStartMessage,
  formatStopMessage,
  textLength,
} from '../src/format.js';
import type { Listing } from '../src/nexon/listing.js';

const spec = loadConfig({ ...readEnvFile('.env.example'), KAKAO_REST_API_KEY: 'k' }).search;

const base: Listing = {
  tradeSn: '1',
  itemName: '에테르넬 나이트헬름',
  pricePerItem: 1234567890,
  quantity: 1,
  starforce: 17,
  potentialGrade: '레전드리',
  potentialLines: ['스킬 재사용 대기시간 -2초', 'STR +9%', 'DEX +3%'],
  additionalGrade: '유니크',
  additionalLines: ['STR +4%', '올스탯 +2%', '공격력 +9'],
  remainUpgradeCount: 0,
  extras: [],
};

test('상수', () => {
  expect(MAX_TEXT_LENGTH).toBe(200);
  expect(BUY_PAGE_URL).toBe('https://auction.maplestory.nexon.com/buy');
});

test('textLength는 코드포인트 단위다', () => {
  expect(textLength('가나다')).toBe(3);
  expect(textLength('😀a')).toBe(2);
});

test('formatMeso는 천 단위 구분을 직접 한다', () => {
  expect(formatMeso(1234567890)).toBe('1,234,567,890 메소');
  expect(formatMeso(0)).toBe('0 메소');
  expect(formatMeso(999)).toBe('999 메소');
  expect(formatMeso(1000)).toBe('1,000 메소');
});

test('매물 메시지 기본 형태', () => {
  const m = formatListingMessage(base, 1, 3);
  expect(m.split('\n')[0]).toBe('[1/3] 1,234,567,890 메소');
  expect(m).toContain('에테르넬 나이트헬름');
  expect(m).toContain('잠재 레전드리: 스킬 재사용 대기시간 -2초 / STR +9% / DEX +3%');
  expect(m).toContain('에디 유니크: STR +4% / 올스탯 +2% / 공격력 +9');
  expect(m).toContain('17성 · 업횟 0');
  expect(textLength(m)).toBeLessThanOrEqual(200);
});

test('줄 순서와 extras', () => {
  const m = formatListingMessage({ ...base, extras: ['추가 A', '추가 B'] }, 1, 1);
  expect(m.split('\n')).toEqual([
    '[1/1] 1,234,567,890 메소',
    '에테르넬 나이트헬름',
    '잠재 레전드리: 스킬 재사용 대기시간 -2초 / STR +9% / DEX +3%',
    '에디 유니크: STR +4% / 올스탯 +2% / 공격력 +9',
    '17성 · 업횟 0',
    '추가 A',
    '추가 B',
  ]);
});

test('에디셔널과 스타포스가 없으면 그 줄이 빠지고 undefined가 없다', () => {
  const m = formatListingMessage({ ...base, additionalGrade: null, additionalLines: [], starforce: null, remainUpgradeCount: null }, 2, 2);
  expect(m).not.toMatch(/에디|성 ·|undefined|null/);
  expect(m.startsWith('[2/2]')).toBe(true);
});

test('등급만 null이고 줄이 있으면 등급 없이 표기한다', () => {
  const m = formatListingMessage({ ...base, potentialGrade: null, additionalGrade: null }, 1, 1);
  expect(m).toContain('\n잠재: 스킬 재사용 대기시간 -2초 / STR +9% / DEX +3%');
  expect(m).toContain('\n에디: STR +4% / 올스탯 +2% / 공격력 +9');
});

test('잠재 정보가 전혀 없어도 세 번째 줄은 남는다', () => {
  const m = formatListingMessage({ ...base, potentialGrade: null, potentialLines: [] }, 1, 1);
  expect(m.split('\n')[2]).toBe('잠재 정보 없음');
  expect(m).not.toMatch(/undefined|null/);
});

test('스타포스와 업횟 중 하나만 있으면 그 부분만 낸다', () => {
  expect(formatListingMessage({ ...base, remainUpgradeCount: null }, 1, 1)).toContain('\n17성');
  expect(formatListingMessage({ ...base, remainUpgradeCount: null }, 1, 1)).not.toContain('업횟');
  const m = formatListingMessage({ ...base, starforce: null }, 1, 1);
  expect(m).toContain('\n업횟 0');
  expect(m).not.toContain('성 ·');
});

test('너무 길면 뒤에서부터 잘라 200자 이하로, 가격/이름/잠재는 남긴다', () => {
  const long = {
    ...base,
    potentialLines: Array(3).fill('아주 긴 잠재 옵션 설명 문장이 여기에 들어갑니다 정말로 깁니다'),
    extras: ['추가 정보 1', '추가 정보 2'],
  };
  const m = formatListingMessage(long, 1, 1);
  expect(textLength(m)).toBeLessThanOrEqual(200);
  expect(m).toContain('1,234,567,890 메소');
  expect(m).toContain('에테르넬 나이트헬름');
  expect(m).toContain('잠재 레전드리');
  expect(m).not.toContain('추가 정보');
});

test('앞 세 줄만으로도 넘치면 잠재 줄을 …로 잘라 정확히 200자 이하로 맞춘다', () => {
  const huge = { ...base, potentialLines: Array(10).fill('아주 긴 잠재 옵션 설명 문장이 여기에 들어갑니다 정말로 깁니다') };
  const m = formatListingMessage(huge, 1, 1);
  const lines = m.split('\n');
  expect(lines).toHaveLength(3);
  expect(textLength(m)).toBe(200);
  expect(lines[2].endsWith('…')).toBe(true);
  expect(lines[2].startsWith('잠재 레전드리: ')).toBe(true);
  expect(lines[0]).toBe('[1/1] 1,234,567,890 메소');
});

test('고정 문구', () => {
  expect(formatLoginRequiredMessage()).toBe('[옥션] 로그인이 필요합니다. 회사 PC 브라우저 창에서 넥슨 로그인을 해 주세요.');
  expect(formatLimitMessage(9)).toBe('[옥션] 오늘 남은 검색이 9회라 검색을 멈춥니다. 내일 다시 시작합니다.');
  expect(formatStartMessage(spec, 96)).toBe('[옥션 감시 시작]\n에테르넬 나이트헬름 / 레전드리 / 스킬 재사용 대기시간 감소 2, STR %증가 9\n오늘 남은 검색 96회');
  expect(formatNoResultsMessage(spec)).toBe('[옥션] 조건에 맞는 매물이 없습니다.\n에테르넬 나이트헬름');
  expect(formatFailureMessage(3, 'timeout')).toBe('[옥션] 검색이 3번 연속 실패했습니다.\ntimeout');
  expect(formatStopMessage('로그인 만료')).toBe('[옥션 감시 중단] 로그인 만료');
});

test('옵션이 없으면 옵션 없음', () => {
  expect(formatStartMessage({ ...spec, potentialOptions: [] }, 5)).toBe('[옥션 감시 시작]\n에테르넬 나이트헬름 / 레전드리 / 옵션 없음\n오늘 남은 검색 5회');
});

test('이름이 너무 길어도 최종 상한 200자를 지킨다', () => {
  const m = formatListingMessage({ ...base, itemName: '가'.repeat(250) }, 1, 1);
  expect(textLength(m)).toBe(200);
  expect(m.endsWith('…')).toBe(true);
  expect(m.split('\n')[0]).toBe('[1/1] 1,234,567,890 메소');
});

test('실패/중단 메시지는 긴 사유여도 200자 이내이고 접두어를 유지한다', () => {
  const reason = '가'.repeat(255);
  const f = formatFailureMessage(3, reason);
  expect(textLength(f)).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
  expect(f.startsWith('[옥션] 검색이 3번 연속 실패했습니다.\n')).toBe(true);
  const s = formatStopMessage(reason);
  expect(textLength(s)).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
  expect(s.startsWith('[옥션 감시 중단] ')).toBe(true);
});

test('실패/중단 메시지는 사유의 첫 줄만 쓴다', () => {
  expect(formatStopMessage('첫 줄\n  at stack\r\n  at more')).toBe('[옥션 감시 중단] 첫 줄');
  expect(formatFailureMessage(3, 'Error: boom\n  at x')).toBe('[옥션] 검색이 3번 연속 실패했습니다.\nError: boom');
});
