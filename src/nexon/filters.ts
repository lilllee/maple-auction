import type { OptionRow, SearchSpec } from '../config.js';
import { GRADE_NUMBERS, type GradeCode } from './options.js';

export interface Selection {
  accountId: number; worldId: number; characterId: number; worldName: string; characterName: string;
}
export type SearchRequestBody = Record<string, unknown>;
export const SORT_PRICE_PER_ITEM_ASC = 'PRICE_PER_ITEM_ASC';

const BOOLEAN_OPTION_CODES: ReadonlySet<string> = new Set([
  'hasteSkill', 'mysticDoorSkill', 'sharpEyesSkill', 'hyperBodySkill',
  'combatOrdersSkill', 'advancedBlessSkill', 'windBoosterSkill', 'skillLevelIncrease',
]);

const optionValue = (row: OptionRow): number | true => (BOOLEAN_OPTION_CODES.has(row.code) ? true : row.min);

/** 잠재능력/에디셔널 한 묶음(등급 + 옵션)을 enhancementOption 키로 풀어 넣는다. */
function addPotential(
  out: Record<string, unknown>, prefix: 'potential' | 'additionalPotential',
  grade: GradeCode, sum: boolean, rows: readonly OptionRow[],
): void {
  if (grade !== 'all') out[`${prefix}Grade`] = GRADE_NUMBERS[grade];
  if (rows.length === 0) return;
  if (sum) {
    out[`${prefix}OptionSum`] = Object.fromEntries(rows.map((r) => [r.code, optionValue(r)]));
  } else {
    out[`${prefix}Options`] = rows.map((r) => ({ [r.code]: optionValue(r) }));
  }
}

export function buildSearchRequest(
  spec: SearchSpec, sel: Selection, opts: { page?: number; limit?: number } = {},
): SearchRequestBody {
  const enhancement: Record<string, unknown> = {};
  if (spec.starforceMin !== null) enhancement.starforceMin = spec.starforceMin;
  if (spec.starforceMax !== null) enhancement.starforceMax = spec.starforceMax;
  addPotential(enhancement, 'potential', spec.potentialGrade, spec.potentialSum, spec.potentialOptions);
  addPotential(
    enhancement, 'additionalPotential',
    spec.additionalPotentialGrade, spec.additionalPotentialSum, spec.additionalPotentialOptions,
  );

  const filters: Record<string, unknown> = { keyword: spec.itemName };
  if (spec.exactMatch) filters.exactMatch = true;
  filters.itemCategory = { itemDetailCategory: spec.itemCategory };
  if (spec.priceMax !== null) filters.price = { max: spec.priceMax };
  if (Object.keys(enhancement).length > 0) filters.enhancementOption = enhancement;

  return {
    worldId: sel.worldId,
    accountId: sel.accountId,
    page: opts.page ?? 1,
    limit: opts.limit ?? 20,
    sortType: SORT_PRICE_PER_ITEM_ASC,
    filters,
    saveRecentKeyword: false,
    characterId: sel.characterId,
  };
}
