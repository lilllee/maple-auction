import { afterEach, describe, expect, test, vi } from 'vitest';
import type { SearchSpec } from '../src/config.js';
import {
  formatFailureMessage, formatLoginRequiredMessage, formatNoResultsMessage,
} from '../src/format.js';
import { SessionExpiredError } from '../src/nexon/api.js';
import type { Listing } from '../src/nexon/listing.js';
import { FAILURE_ALERT_AT, localDateString, runCycle, startLoop, type LoopStatus, type WatchDeps } from '../src/watch/loop.js';
import { EMPTY_STATE } from '../src/watch/state.js';

const SPEC: SearchSpec = {
  itemName: '에테르넬 나이트헬름', exactMatch: true, itemCategory: 'ARMOR',
  potentialGrade: 'all', potentialSum: false, potentialOptions: [],
  additionalPotentialGrade: 'all', additionalPotentialSum: false, additionalPotentialOptions: [],
  starforceMin: null, starforceMax: null, priceMax: null,
};

function L(sn: string, p: number): Listing {
  return {
    tradeSn: sn, itemName: '아이템', pricePerItem: p, quantity: 1, starforce: null,
    potentialGrade: null, potentialLines: [], additionalGrade: null, additionalLines: [],
    remainUpgradeCount: null, extras: [],
  };
}

function makeDeps(over: Partial<WatchDeps> = {}): WatchDeps & { sent: string[] } {
  const sent: string[] = [];
  return {
    search: async () => [],
    getRemaining: async () => 50,
    notify: async (t: string) => { sent.push(t); },
    recoverSession: async () => false,
    onLoginRequired: async () => {},
    now: () => new Date(2026, 9, 20, 10, 0, 0),
    state: { ...EMPTY_STATE },
    saveState: () => {},
    spec: SPEC, topN: 3, minRemainingSearches: 10,
    log: () => {},
    ...over,
    sent,
  };
}

let st: LoopStatus;
const fresh = () => { st = { consecutiveFailures: 0 }; };

describe('runCycle', () => {
  test('결과가 바뀌면 N건 보내고 지문을 저장한다', async () => {
    fresh();
    const d = makeDeps({ search: async () => [L('a', 10), L('b', 20), L('c', 30), L('d', 40)] });
    expect(await runCycle(d, st)).toBe('notified');
    expect(d.sent.map(s => s.split('\n')[0])).toEqual(['[1/3] 10 메소', '[2/3] 20 메소', '[3/3] 30 메소']);
    expect(d.state.lastFingerprint).toBe('a:10|b:20|c:30');
    expect(await runCycle(d, st)).toBe('unchanged'); expect(d.sent).toHaveLength(3);
  });
  test('가격이 하나라도 바뀌면 3건을 다시 보낸다', async () => {
    fresh();
    let items = [L('a', 10), L('b', 20), L('c', 30)];
    const d = makeDeps({ search: async () => items });
    await runCycle(d, st); items = [L('a', 10), L('b', 15), L('c', 30)];
    expect(await runCycle(d, st)).toBe('notified'); expect(d.sent).toHaveLength(6);
  });
  test('0건이면 매물 없음 메시지를 1번만', async () => {
    fresh();
    const d = makeDeps({ search: async () => [] });
    expect(await runCycle(d, st)).toBe('notified'); expect(await runCycle(d, st)).toBe('unchanged');
    expect(d.sent).toEqual([formatNoResultsMessage(d.spec)]);
  });
  test('한도 이하면 검색하지 않고 하루 1번만 알린다', async () => {
    fresh();
    const searchSpy = vi.fn(async () => []);
    const d = makeDeps({ getRemaining: async () => 10, search: searchSpy });
    expect(await runCycle(d, st)).toBe('limit'); expect(await runCycle(d, st)).toBe('limit');
    expect(searchSpy).not.toHaveBeenCalled(); expect(d.sent).toHaveLength(1);
    expect(d.state.limitAlertDate).toBe(localDateString(d.now()));
    expect(d.state.limitAlertDate).toBe('2026-10-20');
  });
  test('세션 만료: 새로고침으로 복구되면 알림 없이 recovered', async () => {
    fresh();
    const d = makeDeps({ search: async () => { throw new SessionExpiredError('x'); }, recoverSession: async () => true });
    expect(await runCycle(d, st)).toBe('recovered'); expect(d.sent).toHaveLength(0);
  });
  test('세션 만료: 복구 실패면 로그인 알림 후 onLoginRequired를 기다린다', async () => {
    fresh();
    const login = vi.fn(async () => {});
    const d = makeDeps({ search: async () => { throw new SessionExpiredError('x'); }, recoverSession: async () => false, onLoginRequired: login });
    expect(await runCycle(d, st)).toBe('relogin'); expect(login).toHaveBeenCalledTimes(1);
    expect(d.sent).toEqual([formatLoginRequiredMessage()]);
  });
  test('일반 오류는 3번째에만 알린다', async () => {
    fresh();
    const d = makeDeps({ search: async () => { throw new Error('boom'); } });
    for (let i = 0; i < 4; i++) expect(await runCycle(d, st)).toBe('failed');
    expect(d.sent).toEqual([formatFailureMessage(FAILURE_ALERT_AT, 'Error: boom')]); expect(st.consecutiveFailures).toBe(4);
  });
  test('notify가 던져도 runCycle은 던지지 않는다', async () => {
    fresh();
    const log = vi.fn();
    const d = makeDeps({ search: async () => [L('a', 10)], notify: async () => { throw new Error('kakao down'); }, log });
    await expect(runCycle(d, st)).resolves.toBe('notified'); expect(d.state.lastFingerprint).toBe('a:10');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('알림 전송 실패'));
  });
  test('성공(notified/unchanged)이면 연속 실패 횟수를 0으로 되돌린다', async () => {
    fresh();
    st.consecutiveFailures = 2;
    const d = makeDeps({ search: async () => [L('a', 10)] });
    await runCycle(d, st); expect(st.consecutiveFailures).toBe(0);
  });
});

describe('startLoop', () => {
  afterEach(() => { vi.useRealTimers(); });
  test('즉시 1회 실행하고 간격마다 반복하며 stop 후에는 멈춘다', async () => {
    vi.useFakeTimers();
    const search = vi.fn(async () => [] as Listing[]);
    const d = makeDeps({ search });
    const loop = startLoop(d, 1000);
    await vi.advanceTimersByTimeAsync(0); expect(search).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); expect(search).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000); expect(search).toHaveBeenCalledTimes(3);
    loop.stop();
    await vi.advanceTimersByTimeAsync(5000); expect(search).toHaveBeenCalledTimes(3);
  });
  test('주기가 진행 중이면 다음 틱을 건너뛴다', async () => {
    vi.useFakeTimers();
    const search = vi.fn(() => new Promise<Listing[]>(r => setTimeout(() => r([]), 2500)));
    const loop = startLoop(makeDeps({ search }), 1000);
    await vi.advanceTimersByTimeAsync(2000); expect(search).toHaveBeenCalledTimes(1);
    loop.stop();
    await vi.advanceTimersByTimeAsync(3000);
  });
});
