import type { AuctionBrowser } from './browser.js';
import type { SearchRequestBody, Selection } from './filters.js';
import { listingsFromResponse, type Listing } from './listing.js';
import { findWorldId, normalizeLabel } from './options.js';

export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export function toApiError(status: number, data: unknown): SessionExpiredError | ApiError {
  if (status === 401 || status === 426) {
    return new SessionExpiredError(`세션이 만료되었습니다 (HTTP ${status})`);
  }
  let body: string;
  try {
    body = JSON.stringify(data) ?? String(data);
  } catch {
    body = String(data);
  }
  return new ApiError(`옥션 API 오류 (HTTP ${status}): ${body.slice(0, 200)}`, status);
}

function ok2xx<T>(res: { status: number; data: T | null }): T | null {
  if (res.status < 200 || res.status >= 300) throw toApiError(res.status, res.data);
  return res.data;
}

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

function list(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.map(rec) : [];
}

export async function getDailyLimit(b: AuctionBrowser): Promise<{ remaining: number; limit: number }> {
  const res = await b.apiFetch<unknown>('GET', '/v1/market/web/daily-limit');
  const search = rec(rec(ok2xx(res)).search);
  if (typeof search.remaining !== 'number') {
    throw new ApiError('일일 검색 한도 응답을 이해할 수 없습니다', res.status);
  }
  return { remaining: search.remaining, limit: typeof search.limit === 'number' ? search.limit : 100 };
}

export async function searchListings(b: AuctionBrowser, body: SearchRequestBody): Promise<Listing[]> {
  const res = await b.apiFetch<unknown>('POST', '/v1/market/web/items/searches/tool-tip', body);
  return listingsFromResponse(ok2xx(res));
}

export async function resolveSelection(
  b: AuctionBrowser,
  cfg: { worldName: string | null; characterName: string | null },
): Promise<Selection> {
  const wantWorld = cfg.worldName === null ? null : normalizeLabel(cfg.worldName);
  const wantWorldId = wantWorld === null ? null : findWorldId(wantWorld);
  const wantChar = cfg.characterName === null ? null : cfg.characterName.trim();

  const usable: Selection[] = [];
  const seenWorlds = new Set<string>(); // 필터와 무관하게 확인된 월드 이름 (안내 메시지용)
  const everyUsable: Selection[] = []; // 이름 조건과 무관하게 선택 가능한 전체 (안내 메시지용)
  let blocked: { name: string; reason: number } | null = null;

  const accounts = list(rec(ok2xx(await b.apiFetch<unknown>('GET', '/v1/accounts'))).accounts);
  for (const acc of accounts) {
    const accountId = acc.accountId;
    if (typeof accountId !== 'number' || !Number.isFinite(accountId)) continue;
    const worlds = list(rec(ok2xx(await b.apiFetch<unknown>('GET', `/v1/accounts/${accountId}/gameWorlds`))).gameWorlds);
    for (const w of worlds) {
      const worldId = w.gameWorldId;
      if (typeof worldId !== 'number' || !Number.isFinite(worldId)) continue;
      const worldName = String(w.gameWorldName ?? '');
      seenWorlds.add(worldName);
      if (wantWorld !== null && normalizeLabel(worldName) !== wantWorld && wantWorldId !== worldId) continue;
      const path = `/v1/accounts/${accountId}/gameWorlds/${worldId}/characters`;
      for (const c of list(rec(ok2xx(await b.apiFetch<unknown>('GET', path))).characters)) {
        const characterName = String(c.characterName ?? '');
        const reason = c.tradeUnavailableReason;
        const isBlocked = reason !== null && reason !== undefined;
        if (typeof c.characterId !== 'number' || !Number.isFinite(c.characterId)) continue;
        const sel: Selection = { accountId, worldId, characterId: c.characterId, worldName, characterName };
        if (!isBlocked) everyUsable.push(sel);
        if (wantChar !== null && characterName.trim() !== wantChar) continue;
        if (isBlocked) {
          blocked ??= { name: characterName, reason: Number(reason) };
          continue;
        }
        usable.push(sel);
      }
    }
  }

  if (usable.length === 1) return usable[0];
  if (usable.length === 0 && blocked !== null && wantChar !== null) {
    throw new ApiError(
      `[설정 필요] 캐릭터 '${blocked.name}'은(는) 옥션을 이용할 수 없는 상태입니다 (사유 코드 ${blocked.reason})`, 0);
  }
  const choices = [...new Set(everyUsable.map((s) => `${s.worldName}/${s.characterName}`))].join(', ');
  if (usable.length === 0) {
    const hint = choices !== '' ? `가능한 값: ${choices}` : `가능한 월드: ${[...seenWorlds].join(', ')}`;
    throw new ApiError(`[설정 필요] 조건에 맞는 월드/캐릭터가 없습니다. ${hint}`, 0);
  }
  throw new ApiError(`[설정 필요] WORLD_NAME 또는 CHARACTER_NAME을 정해 주세요. 가능한 값: ${choices}`, 0);
}
