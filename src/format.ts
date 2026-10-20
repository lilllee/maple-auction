import type { SearchSpec } from './config.js';
import { GRADES } from './nexon/options.js';
import type { Listing } from './nexon/listing.js';

export const MAX_TEXT_LENGTH = 200;
export const BUY_PAGE_URL = 'https://auction.maplestory.nexon.com/buy';

const CORE_LINES = 3;

export function textLength(s: string): number {
  return Array.from(s).length;
}

export function formatMeso(n: number): string {
  const digits = String(Math.trunc(n));
  const negative = digits.startsWith('-');
  const body = negative ? digits.slice(1) : digits;
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped} 메소`;
}

function gradedLine(prefix: string, grade: string | null, lines: string[]): string {
  const head = grade ? `${prefix} ${grade}` : prefix;
  return `${head}: ${lines.join(' / ')}`;
}

function truncateWithEllipsis(s: string, maxLength: number): string {
  const chars = Array.from(s);
  if (chars.length <= maxLength) return s;
  return `${chars.slice(0, Math.max(maxLength - 1, 0)).join('')}…`;
}

export function formatListingMessage(l: Listing, index: number, total: number): string {
  const lines: string[] = [
    `[${index}/${total}] ${formatMeso(l.pricePerItem)}`,
    l.itemName,
    l.potentialGrade === null && l.potentialLines.length === 0
      ? '잠재 정보 없음'
      : gradedLine('잠재', l.potentialGrade, l.potentialLines),
  ];

  if (l.additionalGrade !== null || l.additionalLines.length > 0) {
    lines.push(gradedLine('에디', l.additionalGrade, l.additionalLines));
  }

  const stats: string[] = [];
  if (l.starforce !== null) stats.push(`${l.starforce}성`);
  if (l.remainUpgradeCount !== null) stats.push(`업횟 ${l.remainUpgradeCount}`);
  if (stats.length > 0) lines.push(stats.join(' · '));

  lines.push(...l.extras);

  while (lines.length > CORE_LINES && textLength(lines.join('\n')) > MAX_TEXT_LENGTH) {
    lines.pop();
  }

  if (textLength(lines.join('\n')) > MAX_TEXT_LENGTH) {
    const fixed = textLength(`${lines[0]}\n${lines[1]}\n`);
    lines[2] = truncateWithEllipsis(lines[2], MAX_TEXT_LENGTH - fixed);
  }

  return lines.join('\n');
}

function gradeLabel(code: SearchSpec['potentialGrade']): string {
  return GRADES.find((g) => g.code === code)?.label ?? String(code);
}

export function formatStartMessage(spec: SearchSpec, remaining: number): string {
  const options =
    spec.potentialOptions.length > 0
      ? spec.potentialOptions.map((o) => `${o.label} ${o.min}`).join(', ')
      : '옵션 없음';
  return `[옥션 감시 시작]\n${spec.itemName} / ${gradeLabel(spec.potentialGrade)} / ${options}\n오늘 남은 검색 ${remaining}회`;
}

export function formatNoResultsMessage(spec: SearchSpec): string {
  return `[옥션] 조건에 맞는 매물이 없습니다.\n${spec.itemName}`;
}

export function formatLoginRequiredMessage(): string {
  return '[옥션] 로그인이 필요합니다. 회사 PC 브라우저 창에서 넥슨 로그인을 해 주세요.';
}

export function formatLimitMessage(remaining: number): string {
  return `[옥션] 오늘 남은 검색이 ${remaining}회라 검색을 멈춥니다. 내일 다시 시작합니다.`;
}

export function formatFailureMessage(count: number, lastError: string): string {
  return `[옥션] 검색이 ${count}번 연속 실패했습니다.\n${lastError}`;
}

export function formatStopMessage(reason: string): string {
  return `[옥션 감시 중단] ${reason}`;
}
