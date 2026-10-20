import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createWatchDeps, errorMessage, exitCodeFor, type Session } from '../src/cli/_bootstrap.js';
import { ConfigError, type AppConfig, type SearchSpec } from '../src/config.js';
import type { Notifier } from '../src/kakao/send.js';
import { ApiError } from '../src/nexon/api.js';
import type { AuctionBrowser } from '../src/nexon/browser.js';
import { EMPTY_STATE } from '../src/watch/state.js';

const SPEC: SearchSpec = {
  itemName: '에테르넬 나이트헬름', exactMatch: true, itemCategory: 'ARMOR',
  potentialGrade: 'all', potentialSum: false, potentialOptions: [],
  additionalPotentialGrade: 'all', additionalPotentialSum: false, additionalPotentialOptions: [],
  starforceMin: null, starforceMax: null, priceMax: null,
};

const CONFIG: AppConfig = {
  search: SPEC, worldName: null, characterName: null,
  intervalMinutes: 15, topN: 3, minRemainingSearches: 5,
  kakao: { restApiKey: 'k', clientSecret: null, redirectPort: 8080 },
  dataDir: 'data',
};

const BODY = { keyword: 'x' } as unknown as Session['body'];

interface FakeOpts {
  apiFetch?: (method: string, path: string, body?: unknown) => Promise<{ status: number; data: unknown }>;
  restore?: () => Promise<void>;
}

function setup(opts: FakeOpts = {}) {
  const calls: string[] = [];
  const fetches: Array<{ method: string; path: string; body?: unknown }> = [];
  const browser = {
    async apiFetch(method: string, p: string, body?: unknown) {
      fetches.push({ method, path: p, body });
      return opts.apiFetch ? opts.apiFetch(method, p, body) : { status: 200, data: null };
    },
    async waitForSession(ms: number, o?: { navigate?: boolean }) {
      calls.push(o ? `wait(${ms},${JSON.stringify(o)})` : `wait(${ms})`);
      return true;
    },
    async restore() {
      calls.push('restore');
      if (opts.restore) await opts.restore();
    },
    async minimize() { calls.push('minimize'); },
  } as unknown as AuctionBrowser;
  const sent: string[] = [];
  const notifier: Notifier = { async send(t) { sent.push(t); } };
  const logs: string[] = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maple-'));
  const stateFile = path.join(dir, 'state.json');
  const state = { ...EMPTY_STATE };
  const session: Session = {
    config: CONFIG, browser, selection: {} as unknown as Session['selection'], body: BODY,
  };
  const deps = createWatchDeps({ session, notifier, state, stateFile, log: (m) => logs.push(m) });
  return { deps, calls, fetches, sent, logs, stateFile, state };
}

describe('createWatchDeps', () => {
  test('search는 세션 본문으로 검색 API를 호출한다', async () => {
    const t = setup({ apiFetch: async () => ({ status: 201, data: { items: [] } }) });
    expect(await t.deps.search()).toEqual([]);
    expect(t.fetches).toEqual([
      { method: 'POST', path: '/v1/market/web/items/searches/tool-tip', body: BODY },
    ]);
  });

  test('getRemaining은 daily-limit의 search.remaining을 돌려준다', async () => {
    const t = setup({
      apiFetch: async () => ({ status: 200, data: { search: { remaining: 42, limit: 100 } } }),
    });
    expect(await t.deps.getRemaining()).toBe(42);
    expect(t.fetches[0]).toMatchObject({ method: 'GET', path: '/v1/market/web/daily-limit' });
  });

  test('recoverSession은 waitForSession(15000)의 결과를 돌려준다', async () => {
    const t = setup();
    expect(await t.deps.recoverSession()).toBe(true);
    expect(t.calls).toEqual(['wait(15000)']);
  });

  test('onLoginRequired는 restore, 로그인 대기, minimize 순으로 실행한다', async () => {
    const t = setup();
    await t.deps.onLoginRequired();
    expect(t.calls).toEqual(['restore', 'wait(0,{"navigate":false})', 'minimize']);
  });

  test('onLoginRequired는 실패해도 reject하지 않고 로그를 남긴다', async () => {
    const t = setup({ restore: async () => { throw new Error('창 없음'); } });
    await expect(t.deps.onLoginRequired()).resolves.toBeUndefined();
    expect(t.logs.some((l) => l.startsWith('로그인 대기 중 오류'))).toBe(true);
  });

  test('notify는 알림기로 전달한다', async () => {
    const t = setup();
    await t.deps.notify('안녕');
    expect(t.sent).toEqual(['안녕']);
  });

  test('saveState는 상태 파일에 JSON으로 쓴다', () => {
    const t = setup();
    const s = { lastFingerprint: 'fp', lastResultCount: 2, limitAlertDate: null };
    t.deps.saveState(s);
    expect(JSON.parse(fs.readFileSync(t.stateFile, 'utf8'))).toEqual(s);
  });

  test('설정 값과 기본 now를 연결한다', () => {
    const t = setup();
    expect(t.deps.spec).toBe(SPEC);
    expect(t.deps.topN).toBe(3);
    expect(t.deps.minRemainingSearches).toBe(5);
    expect(t.deps.state).toBe(t.state);
    expect(t.deps.now()).toBeInstanceOf(Date);
  });
});

describe('exitCodeFor / errorMessage', () => {
  test('종료 코드', () => {
    expect(exitCodeFor(new ConfigError('x'))).toBe(2);
    expect(exitCodeFor(new ApiError('x', 0))).toBe(2);
    expect(exitCodeFor(new ApiError('x', 500))).toBe(1);
    expect(exitCodeFor(new Error('x'))).toBe(1);
    expect(exitCodeFor('str')).toBe(1);
  });

  test('오류 메시지', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('str')).toBe('str');
  });
});
