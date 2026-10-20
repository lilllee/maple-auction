import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  ADDITIONAL_POTENTIAL_OPTIONS,
  GRADES,
  POTENTIAL_OPTIONS,
  WORLDS,
  findGradeCode,
  findOptionCode,
  findWorldId,
  normalizeLabel,
  type GradeCode,
  type OptionEntry,
} from './nexon/options.js';

export interface OptionRow { code: string; label: string; min: number }
export interface SearchSpec {
  itemName: string; exactMatch: boolean;
  potentialGrade: GradeCode; potentialSum: boolean; potentialOptions: OptionRow[];
  additionalPotentialGrade: GradeCode; additionalPotentialSum: boolean; additionalPotentialOptions: OptionRow[];
  starforceMin: number | null; starforceMax: number | null; priceMax: number | null;
}
export interface AppConfig {
  search: SearchSpec;
  worldName: string | null; characterName: string | null;
  intervalMinutes: number; topN: number; minRemainingSearches: number;
  kakao: { restApiKey: string; clientSecret: string | null; redirectPort: number };
  dataDir: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

const fail = (key: string, detail: string): never => {
  throw new ConfigError(`[설정 오류] ${key}: ${detail}`);
};

/** 앞뒤 공백을 지우고, 빈 문자열은 "없음"(null)으로 본다. */
function optional(env: Env, key: string): string | null {
  const v = env[key]?.trim();
  return v ? v : null;
}

function required(env: Env, key: string): string {
  return optional(env, key) ?? fail(key, '필수 값입니다. .env에 값을 적어 주세요.');
}

function parsePositive(key: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) fail(key, `'${raw}'은(는) 0보다 큰 숫자가 아닙니다.`);
  return n;
}

function numberOr(env: Env, key: string, fallback: number): number {
  const raw = optional(env, key);
  return raw === null ? fallback : parsePositive(key, raw);
}

function numberOrNull(env: Env, key: string): number | null {
  const raw = optional(env, key);
  return raw === null ? null : parsePositive(key, raw);
}

function boolOr(env: Env, key: string, fallback: boolean): boolean {
  const raw = optional(env, key);
  if (raw === null) return fallback;
  const v = raw.toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fail(key, `'${raw}'은(는) true 또는 false여야 합니다.`);
}

function gradeOr(env: Env, key: string): GradeCode {
  const raw = optional(env, key);
  if (raw === null) return 'all';
  return (
    findGradeCode(raw) ??
    fail(key, `'${raw}'은(는) 모르는 등급입니다. 가능한 값: ${GRADES.map((g) => g.label).join(', ')}`)
  );
}

export function parseOptionRows(raw: string, table: readonly OptionEntry[], key = 'POTENTIAL_OPTIONS'): OptionRow[] {
  const rows: OptionRow[] = [];
  for (const part of raw.split(',')) {
    if (part.trim() === '') continue;
    const sep = part.lastIndexOf(':');
    if (sep < 0) fail(key, `'${part.trim()}'에 ':'가 없습니다. '라벨:숫자' 형식으로 적어 주세요.`);
    const label = normalizeLabel(part.slice(0, sep));
    const minRaw = part.slice(sep + 1).trim();
    const code = findOptionCode(label, table);
    if (code === null) {
      fail(key, `'${label}'은(는) 모르는 옵션입니다. 가능한 값: ${table.map((o) => o.label).join(', ')}`);
    }
    rows.push({ code: code as string, label, min: parsePositive(key, minRaw) });
  }
  return rows;
}

export function loadConfig(env: Env): AppConfig {
  const worldName = optional(env, 'WORLD_NAME');
  if (worldName !== null && findWorldId(worldName) === null) {
    fail('WORLD_NAME', `'${worldName}'은(는) 모르는 월드입니다. 가능한 값: ${WORLDS.map((w) => w.name).join(', ')}`);
  }

  const search: SearchSpec = {
    itemName: required(env, 'ITEM_NAME'),
    exactMatch: boolOr(env, 'ITEM_EXACT_MATCH', true),
    potentialGrade: gradeOr(env, 'POTENTIAL_GRADE'),
    potentialSum: boolOr(env, 'POTENTIAL_SUM', false),
    potentialOptions: parseOptionRows(optional(env, 'POTENTIAL_OPTIONS') ?? '', POTENTIAL_OPTIONS, 'POTENTIAL_OPTIONS'),
    additionalPotentialGrade: gradeOr(env, 'ADDITIONAL_POTENTIAL_GRADE'),
    additionalPotentialSum: boolOr(env, 'ADDITIONAL_POTENTIAL_SUM', false),
    additionalPotentialOptions: parseOptionRows(
      optional(env, 'ADDITIONAL_POTENTIAL_OPTIONS') ?? '',
      ADDITIONAL_POTENTIAL_OPTIONS,
      'ADDITIONAL_POTENTIAL_OPTIONS',
    ),
    starforceMin: numberOrNull(env, 'STARFORCE_MIN'),
    starforceMax: numberOrNull(env, 'STARFORCE_MAX'),
    priceMax: numberOrNull(env, 'PRICE_MAX'),
  };

  return {
    search,
    worldName,
    characterName: optional(env, 'CHARACTER_NAME'),
    intervalMinutes: numberOr(env, 'INTERVAL_MINUTES', 15),
    topN: numberOr(env, 'TOP_N', 3),
    minRemainingSearches: numberOr(env, 'MIN_REMAINING_SEARCHES', 10),
    kakao: {
      restApiKey: required(env, 'KAKAO_REST_API_KEY'),
      clientSecret: optional(env, 'KAKAO_CLIENT_SECRET'),
      redirectPort: numberOr(env, 'KAKAO_REDIRECT_PORT', 3131),
    },
    dataDir: path.resolve(process.cwd(), 'data'),
  };
}

export function readEnvFile(file: string): Record<string, string> {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new ConfigError(`[설정 오류] ${file} 파일을 읽을 수 없습니다. .env.example을 복사해서 .env를 만들어 주세요.`);
  }
  const parsed = dotenv.parse(text.replace(/^﻿/, ''));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) out[k] = v.trim();
  return out;
}
