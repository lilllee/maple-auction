import path from 'node:path';
import { ConfigError, loadConfig, readEnvFile, type AppConfig } from '../config.js';
import type { Notifier } from '../kakao/send.js';
import { ApiError, getDailyLimit, resolveSelection, searchListings } from '../nexon/api.js';
import { AUCTION_ORIGIN, launchAuctionBrowser, type AuctionBrowser } from '../nexon/browser.js';
import { buildSearchRequest, type SearchRequestBody, type Selection } from '../nexon/filters.js';
import type { WatchDeps } from '../watch/loop.js';
import { saveState, type WatchState } from '../watch/state.js';

export interface Session {
  config: AppConfig;
  browser: AuctionBrowser;
  selection: Selection;
  body: SearchRequestBody;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 설정 오류와 선택 실패(status 0)는 2, 그 밖은 1. */
export function exitCodeFor(err: unknown): number {
  if (err instanceof ConfigError) return 2;
  if (err instanceof ApiError && err.status === 0) return 2;
  return 1;
}

export async function openSession(opts: { requireLogin: boolean }): Promise<Session> {
  const config = loadConfig(readEnvFile(path.resolve('.env')));
  const browser = await launchAuctionBrowser(path.join(config.dataDir, 'browser-profile'));
  try {
    const ready = await browser.waitForSession(20000);
    const onAuctionOrigin = new URL(browser.page.url()).origin === AUCTION_ORIGIN;
    if (onAuctionOrigin && (await browser.page.locator('#root').count()) === 0) {
      const title = await browser.page.title();
      throw new Error(`옥션 페이지 대신 차단/오류 페이지가 열렸습니다 (제목: ${title}, 주소: ${browser.page.url()})`);
    }
    if (!ready) {
      if (!opts.requireLogin) {
        throw new ApiError('로그인된 세션이 없습니다. npm start 로 먼저 로그인해 주세요.', 0);
      }
      console.log('브라우저 창에서 넥슨 로그인(OTP)을 끝내 주세요. 끝나면 자동으로 이어집니다.');
      if (!(await browser.waitForSession(0, { navigate: false }))) {
        throw new Error('브라우저 창이 닫혔습니다. 다시 실행해 주세요.');
      }
    }
    await browser.minimize();
    const selection = await resolveSelection(browser, {
      worldName: config.worldName, characterName: config.characterName,
    });
    const body = buildSearchRequest(config.search, selection);
    console.log(`선택: ${selection.worldName} / ${selection.characterName}`);
    return { config, browser, selection, body };
  } catch (err) {
    await browser.close().catch(() => undefined);
    throw err;
  }
}

export function createWatchDeps(parts: {
  session: Session; notifier: Notifier; state: WatchState; stateFile: string;
  log: (msg: string) => void; now?: () => Date;
}): WatchDeps {
  const { session, notifier, state, stateFile, log } = parts;
  const { browser, body, config } = session;
  return {
    search: () => searchListings(browser, body),
    getRemaining: async () => (await getDailyLimit(browser)).remaining,
    notify: (t) => notifier.send(t),
    recoverSession: () => browser.waitForSession(15000),
    onLoginRequired: async () => {
      try {
        await browser.restore();
        await browser.waitForSession(0, { navigate: false });
        await browser.minimize();
      } catch (err) {
        log('로그인 대기 중 오류: ' + errorMessage(err));
      }
    },
    now: parts.now ?? (() => new Date()),
    state,
    saveState: (s) => saveState(stateFile, s),
    spec: config.search,
    topN: config.topN,
    minRemainingSearches: config.minRemainingSearches,
    log,
  };
}
