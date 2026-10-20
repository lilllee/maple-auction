import fs from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  ApiError, SessionExpiredError, getDailyLimit, resolveSelection, searchListings, toApiError,
} from '../src/nexon/api.js';
import type { AuctionBrowser } from '../src/nexon/browser.js';

const fx = (name: string) => JSON.parse(fs.readFileSync(`tests/fixtures/${name}.json`, 'utf8'));
const accounts = fx('accounts');
const gameWorlds = fx('game-worlds');
const characters = fx('characters');
const dailyLimit = fx('daily-limit');
const searchResponse = fx('search-response');

type Route = { status: number; data: unknown };
type Handler = (method: string, path: string) => Route | undefined;

function fakeBrowser(handler: Handler) {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const b = {
    async apiFetch(method: string, path: string, body?: unknown) {
      calls.push(`${method} ${path}`);
      bodies.push(body);
      return handler(method, path) ?? { status: 404, data: null };
    },
  } as unknown as AuctionBrowser;
  return { b, calls, bodies };
}

// 계정 1: 스카니아(캐릭터 5개)+에오스(캐릭터 0개), 계정 2: 에오스 하나(캐릭터 0개)
const multiAccount: Handler = (method, path) => {
  if (method !== 'GET') return undefined;
  if (path === '/v1/accounts') return { status: 200, data: accounts };
  if (path === '/v1/accounts/100000001/gameWorlds') return { status: 200, data: gameWorlds };
  if (path === '/v1/accounts/100000002/gameWorlds') {
    return { status: 200, data: { gameWorlds: [{ gameWorldId: 45, gameWorldName: '에오스' }], defaultGameWorldId: 45 } };
  }
  if (path === '/v1/accounts/100000001/gameWorlds/0/characters') return { status: 200, data: characters };
  if (/\/gameWorlds\/\d+\/characters$/.test(path)) return { status: 200, data: { characters: [] } };
  return undefined;
};

describe('toApiError', () => {
  test('401/426은 세션 만료, 그 외는 ApiError', () => {
    expect(toApiError(401, { code: 5 })).toBeInstanceOf(SessionExpiredError);
    expect(toApiError(426, null)).toBeInstanceOf(SessionExpiredError);
    expect(toApiError(500, null)).toBeInstanceOf(ApiError);
    expect((toApiError(500, null) as ApiError).status).toBe(500);
  });
});

describe('getDailyLimit', () => {
  test('남은 횟수와 한도를 돌려준다', async () => {
    const { b } = fakeBrowser(() => ({ status: 200, data: dailyLimit }));
    expect(await getDailyLimit(b)).toEqual({ remaining: 98, limit: 100 });
  });
  test('401이면 SessionExpiredError', async () => {
    const { b } = fakeBrowser(() => ({ status: 401, data: null }));
    await expect(getDailyLimit(b)).rejects.toBeInstanceOf(SessionExpiredError);
  });
  test('remaining이 숫자가 아니면 ApiError', async () => {
    const { b } = fakeBrowser(() => ({ status: 200, data: { search: {} } }));
    await expect(getDailyLimit(b)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('searchListings', () => {
  test('201이면 매물을 정규화한다', async () => {
    const { b, calls, bodies } = fakeBrowser(() => ({ status: 201, data: searchResponse }));
    const list = await searchListings(b, { page: 1 });
    expect(bodies[0]).toEqual({ page: 1 });
    expect(list.length).toBe(5);
    expect(calls[0]).toBe('POST /v1/market/web/items/searches/tool-tip');
  });
  test('500이면 ApiError', async () => {
    const { b } = fakeBrowser(() => ({ status: 500, data: null }));
    await expect(searchListings(b, {})).rejects.toBeInstanceOf(ApiError);
  });
});

describe('resolveSelection', () => {
  test('월드와 캐릭터 이름으로 고른다', async () => {
    const { b } = fakeBrowser(multiAccount);
    expect(await resolveSelection(b, { worldName: '스카니아', characterName: '테스트캐릭2' })).toEqual({
      accountId: 100000001, worldId: 0, characterId: 200000002, worldName: '스카니아', characterName: '테스트캐릭2',
    });
  });

  test('후보가 하나면 이름 없이 자동 선택', async () => {
    const { b } = fakeBrowser((method, path) => {
      if (path === '/v1/accounts') return { status: 200, data: { accounts: [{ accountId: 7, email: 'a' }] } };
      if (path === '/v1/accounts/7/gameWorlds') {
        return { status: 200, data: { gameWorlds: [{ gameWorldId: 3, gameWorldName: '루나' }] } };
      }
      if (path === '/v1/accounts/7/gameWorlds/3/characters') {
        return { status: 200, data: { characters: [
          { characterId: 9, characterName: '막고', tradeUnavailableReason: null },
          { characterId: 8, characterName: '불가', tradeUnavailableReason: 2 },
        ] } };
      }
      return undefined;
    });
    expect(await resolveSelection(b, { worldName: null, characterName: null })).toEqual({
      accountId: 7, worldId: 3, characterId: 9, worldName: '루나', characterName: '막고',
    });
  });

  test('후보가 여럿이면 가능한 값을 알려준다', async () => {
    const { b } = fakeBrowser(multiAccount);
    const err = await resolveSelection(b, { worldName: null, characterName: null }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toContain('가능한 값');
    expect(err.message).toContain('스카니아/테스트캐릭2');
    expect(err.message).not.toContain('테스트캐릭1');
    expect(err.status).toBe(0);
  });

  test('조건에 맞는 후보가 없으면 가능한 값을 알려준다', async () => {
    const { b } = fakeBrowser(multiAccount);
    const err = await resolveSelection(b, { worldName: '스카니아', characterName: '없는캐릭' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toContain('조건에 맞는 월드/캐릭터가 없습니다');
    expect(err.message).toContain('스카니아/테스트캐릭2');
  });

  test('거래 불가 캐릭터를 지정하면 사유 코드를 알려준다', async () => {
    const { b } = fakeBrowser(multiAccount);
    const err = await resolveSelection(b, { worldName: '스카니아', characterName: '테스트캐릭1' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toContain('사유 코드 6');
  });

  test('캐릭터가 없는 월드는 오류 없이 건너뛴다', async () => {
    const { b } = fakeBrowser(multiAccount);
    const sel = await resolveSelection(b, { worldName: null, characterName: '테스트캐릭3' });
    expect(sel.characterId).toBe(200000003);
  });

  test('모든 계정을 훑는다', async () => {
    const { b, calls } = fakeBrowser(multiAccount);
    await resolveSelection(b, { worldName: '에오스', characterName: null }).catch(() => undefined);
    expect(calls).toContain('GET /v1/accounts/100000002/gameWorlds');
    expect(calls).toContain('GET /v1/accounts/100000002/gameWorlds/45/characters');
  });

  test('중간 요청이 실패하면 toApiError', async () => {
    const { b } = fakeBrowser(() => ({ status: 401, data: null }));
    await expect(resolveSelection(b, { worldName: null, characterName: null })).rejects.toBeInstanceOf(SessionExpiredError);
  });

  test('월드가 하나도 맞지 않으면 가능한 월드를 알려준다', async () => {
    const { b } = fakeBrowser(multiAccount);
    const err = await resolveSelection(b, { worldName: '스카니아아', characterName: null }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toContain('[설정 필요]');
    expect(err.message).toContain('가능한 월드');
    expect(err.message).toContain('스카니아');
  });

  test('id가 없는 계정은 건너뛰고 계속한다', async () => {
    const { b, calls } = fakeBrowser((method, path) => {
      if (path === '/v1/accounts') {
        return { status: 200, data: { accounts: [{ email: 'x' }, ...accounts.accounts] } };
      }
      return multiAccount(method, path);
    });
    const sel = await resolveSelection(b, { worldName: '스카니아', characterName: '테스트캐릭2' });
    expect(sel.characterId).toBe(200000002);
    expect(calls.some((c) => c.includes('NaN') || c.includes('undefined'))).toBe(false);
  });
});
