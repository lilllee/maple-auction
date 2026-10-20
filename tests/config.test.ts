import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { ConfigError, loadConfig, readEnvFile } from '../src/config.js';

const base = {
  ITEM_NAME: '에테르넬 나이트헬름',
  POTENTIAL_GRADE: '레전드리',
  POTENTIAL_SUM: 'true',
  POTENTIAL_OPTIONS: '스킬 재사용 대기시간 감소:2, STR %증가:9',
  KAKAO_REST_API_KEY: 'k',
};

test('예시 조건을 파싱한다', () => {
  const c = loadConfig(base);
  expect(c.search.potentialOptions).toEqual([
    { code: 'skillCooldownReduction', label: '스킬 재사용 대기시간 감소', min: 2 },
    { code: 'strPercent', label: 'STR %증가', min: 9 },
  ]);
  expect(c.search.potentialGrade).toBe('legendary');
  expect(c.search.exactMatch).toBe(true);
  expect(c.intervalMinutes).toBe(15);
  expect(c.topN).toBe(3);
  expect(c.minRemainingSearches).toBe(10);
  expect(c.kakao.redirectPort).toBe(3131);
  expect(c.kakao.clientSecret).toBeNull();
  expect(c.worldName).toBeNull();
  expect(c.search.priceMax).toBeNull();
  expect(c.search.additionalPotentialGrade).toBe('all');
  expect(c.dataDir).toBe(path.resolve(process.cwd(), 'data'));
});

test('모르는 라벨이면 ConfigError에 라벨 목록이 들어간다', () => {
  expect(() => loadConfig({ ...base, POTENTIAL_OPTIONS: '쿨감:2' })).toThrow(/쿨감/);
  expect(() => loadConfig({ ...base, POTENTIAL_OPTIONS: '쿨감:2' })).toThrow(/스킬 재사용 대기시간 감소/);
});

test('필수값 누락', () => {
  expect(() => loadConfig({ ...base, ITEM_NAME: '' })).toThrow(ConfigError);
  expect(() => loadConfig({ ...base, KAKAO_REST_API_KEY: undefined })).toThrow(ConfigError);
  expect(() => loadConfig({ ...base, INTERVAL_MINUTES: '0' })).toThrow(ConfigError);
  expect(() => loadConfig({ ...base, POTENTIAL_OPTIONS: 'STR %증가:abc' })).toThrow(ConfigError);
});

test('에디셔널과 선택 값을 파싱한다', () => {
  const c = loadConfig({
    ...base,
    ADDITIONAL_POTENTIAL_GRADE: '에픽',
    ADDITIONAL_POTENTIAL_OPTIONS: '캐릭터 9레벨 당 STR 증가:1',
    PRICE_MAX: '1000000',
    STARFORCE_MIN: '17',
    WORLD_NAME: '스카니아',
    KAKAO_CLIENT_SECRET: 's',
  });
  expect(c.search.additionalPotentialGrade).toBe('epic');
  expect(c.search.additionalPotentialOptions).toEqual([
    { code: 'strPerLevel', label: '캐릭터 9레벨 당 STR 증가', min: 1 },
  ]);
  expect(c.search.priceMax).toBe(1000000);
  expect(c.search.starforceMin).toBe(17);
  expect(c.worldName).toBe('스카니아');
  expect(c.kakao.clientSecret).toBe('s');
});

test('0을 허용하는 값과 정수 규칙', () => {
  const c = loadConfig({ ...base, STARFORCE_MIN: '0', MIN_REMAINING_SEARCHES: '0' });
  expect(c.search.starforceMin).toBe(0);
  expect(c.minRemainingSearches).toBe(0);
  expect(() => loadConfig({ ...base, TOP_N: '2.5' })).toThrow(ConfigError);
  expect(() => loadConfig({ ...base, TOP_N: '0' })).toThrow(ConfigError);
  expect(() => loadConfig({ ...base, INTERVAL_MINUTES: '-1' })).toThrow(/\[설정 오류\] INTERVAL_MINUTES/);
  expect(() => loadConfig({ ...base, PRICE_MAX: '1.5' })).toThrow(ConfigError);
});

test('모르는 등급과 월드는 ConfigError', () => {
  expect(() => loadConfig({ ...base, POTENTIAL_GRADE: '신화' })).toThrow(/신화/);
  expect(() => loadConfig({ ...base, WORLD_NAME: '없는월드' })).toThrow(ConfigError);
});

test('CRLF, BOM, 앞뒤 공백이 있는 .env 파일을 읽는다', () => {
  const file = path.join(os.tmpdir(), `env-${Date.now()}`);
  fs.writeFileSync(file, '﻿ITEM_NAME= 에테르넬 나이트헬름 \r\nPOTENTIAL_OPTIONS=STR %증가:9\r\n');
  try {
    const env = readEnvFile(file);
    expect(env.ITEM_NAME).toBe('에테르넬 나이트헬름');
    expect(env.POTENTIAL_OPTIONS).toBe('STR %증가:9');
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('없는 .env 파일이면 ConfigError', () => {
  expect(() => readEnvFile(path.join(os.tmpdir(), 'no-such-env-file'))).toThrow(ConfigError);
});

test('ITEM_CATEGORY: 무기는 WEAPON, 비면 ARMOR', () => {
  expect(loadConfig({ ...base, ITEM_CATEGORY: '무기' }).search.itemCategory).toBe('WEAPON');
  expect(loadConfig({ ...base, ITEM_CATEGORY: '' }).search.itemCategory).toBe('ARMOR');
  expect(loadConfig(base).search.itemCategory).toBe('ARMOR');
});

test('ITEM_CATEGORY: 모르는 분류는 ConfigError', () => {
  expect(() => loadConfig({ ...base, ITEM_CATEGORY: '장신구' })).toThrow(ConfigError);
  expect(() => loadConfig({ ...base, ITEM_CATEGORY: '장신구' })).toThrow('가능한 값');
});
