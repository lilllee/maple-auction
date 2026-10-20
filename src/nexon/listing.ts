import { GRADE_NUMBERS, GRADES, type GradeCode } from './options.js';

export interface Listing {
  tradeSn: string; itemName: string; pricePerItem: number; quantity: number;
  starforce: number | null; potentialGrade: string | null; potentialLines: string[];
  additionalGrade: string | null; additionalLines: string[]; remainUpgradeCount: number | null;
  extras: string[];   // 그 밖의 툴팁 한 줄 정보. 없으면 []
}

const GRADE_LABEL_BY_NUMBER = new Map<number, string>(
  GRADES.filter((g) => g.code !== 'all' && g.code !== 'none')
    .map((g) => [GRADE_NUMBERS[g.code as Exclude<GradeCode, 'all'>], g.label]),
);

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function finiteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
}

function readPotential(v: unknown): { grade: string | null; lines: string[] } {
  const p = asRecord(v);
  if (!p) return { grade: null, lines: [] };
  const g = finiteNumber(p.grade);
  const entries = Array.isArray(p.entries) ? p.entries : [];
  const lines: string[] = [];
  for (const e of entries) {
    const text = asRecord(e)?.text;
    if (typeof text === 'string' && text.trim() !== '') lines.push(text.trim());
  }
  return { grade: g === null ? null : GRADE_LABEL_BY_NUMBER.get(g) ?? null, lines };
}

export class ResponseShapeError extends Error {
  name = 'ResponseShapeError';
}

export function normalizeListing(raw: unknown): Listing {
  const r = asRecord(raw);
  if (!r) throw new ResponseShapeError('검색 응답 형식을 이해할 수 없습니다: 매물이 객체가 아닙니다');
  if (r.tradeSn === undefined || r.tradeSn === null || String(r.tradeSn) === '') {
    throw new ResponseShapeError('검색 응답 형식을 이해할 수 없습니다: 매물 번호(tradeSn)가 없습니다');
  }
  const price = finiteNumber(typeof r.pricePerItem === 'string' ? r.pricePerItem.replace(/,/g, '') : r.pricePerItem);
  if (price === null) {
    throw new ResponseShapeError('검색 응답 형식을 이해할 수 없습니다: 가격(pricePerItem)이 숫자가 아닙니다');
  }
  const tip = asRecord(r.toolTip) ?? {};
  const upgrade = asRecord(tip.upgradeInfo) ?? {};
  const potential = readPotential(upgrade.potential);
  const additional = readPotential(upgrade.additionalPotential);
  const itemName = typeof r.itemName === 'string' ? r.itemName
    : typeof tip.itemName === 'string' ? tip.itemName : '';
  const quantity = r.quantity === undefined ? 1 : finiteNumber(r.quantity) ?? 1;
  return {
    tradeSn: String(r.tradeSn),
    itemName,
    pricePerItem: price,
    quantity,
    starforce: finiteNumber(tip.starforce) ?? finiteNumber(r.starforce),
    potentialGrade: potential.grade,
    potentialLines: potential.lines,
    additionalGrade: additional.grade,
    additionalLines: additional.lines,
    remainUpgradeCount: finiteNumber(asRecord(upgrade.scroll)?.remaining),
    extras: [],
  };
}

export function listingsFromResponse(resp: unknown): Listing[] {
  const items = asRecord(resp)?.items;
  if (!Array.isArray(items)) {
    throw new ResponseShapeError('검색 응답 형식을 이해할 수 없습니다: items 배열이 없습니다');
  }
  return items.map(normalizeListing);
}
