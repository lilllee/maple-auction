import { chromium, errors } from 'playwright';
import type { BrowserContext, Page, Request, Response } from 'playwright';

export const AUCTION_ORIGIN = 'https://auction.maplestory.nexon.com';
export const API_BASE = 'https://api.mskr.nexon.com';

const SESSION_PATH = '/v1/auth/web-token/session';
const API_HEADER_NAMES = ['x-device-id', 'x-platform', 'x-client-version'] as const;

export interface ApiResult<T> {
  status: number;
  data: T | null;
}

export interface AuctionBrowser {
  page: Page;
  apiHeaders(): Record<string, string>;
  apiFetch<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResult<T>>;
  waitForSession(timeoutMs: number): Promise<boolean>;
  minimize(): Promise<void>;
  restore(): Promise<void>;
  close(): Promise<void>;
}

export function isApiRequest(url: string): boolean {
  return url.startsWith(API_BASE);
}

export function pickApiHeaders(h: Record<string, string>): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of API_HEADER_NAMES) {
    const value = h[name];
    if (value !== undefined) picked[name] = value;
  }
  return picked;
}

async function setWindowState(
  context: BrowserContext,
  page: Page,
  windowState: 'minimized' | 'normal',
): Promise<void> {
  const cdp = await context.newCDPSession(page);
  try {
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState } });
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

export async function launchAuctionBrowser(profileDir: string): Promise<AuctionBrowser> {
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
    locale: 'ko-KR',
  });
  const page = context.pages()[0] ?? (await context.newPage());

  let captured: Record<string, string> = {};
  page.on('request', (request: Request) => {
    if (!isApiRequest(request.url())) return;
    const picked = pickApiHeaders(request.headers());
    if (Object.keys(picked).length > 0) captured = picked;
  });

  const waitSessionResponse = (timeout: number): Promise<Response> =>
    page.waitForResponse((r) => r.url().includes(SESSION_PATH), { timeout });

  return {
    page,
    apiHeaders: () => ({ ...captured }),

    async apiFetch<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResult<T>> {
      if (Object.keys(captured).length === 0) {
        throw new Error('API 헤더를 아직 캡처하지 못했습니다. 옥션 페이지가 열렸는지 확인하세요.');
      }
      const arg = {
        url: API_BASE + path,
        method,
        headers: { ...captured },
        body: body === undefined ? undefined : JSON.stringify(body),
      };
      return page.evaluate(async (a) => {
        const res = await fetch(a.url, {
          method: a.method,
          headers: { ...a.headers, 'content-type': 'application/json' },
          body: a.body,
          credentials: 'include',
        });
        return { status: res.status, data: await res.json().catch(() => null) };
      }, arg) as Promise<ApiResult<T>>;
    },

    async waitForSession(timeoutMs: number): Promise<boolean> {
      // 응답을 놓치지 않도록 goto 전에 대기 프라미스를 먼저 만든다.
      let pending = waitSessionResponse(timeoutMs);
      pending.catch(() => undefined); // goto 실패 시 unhandled rejection 방지
      try {
        await page.goto(AUCTION_ORIGIN + '/buy', { waitUntil: 'domcontentloaded' });
        for (;;) {
          const res = await pending;
          if (res.status() === 200) return true;
          pending = waitSessionResponse(timeoutMs);
          pending.catch(() => undefined);
        }
      } catch (e) {
        if (e instanceof errors.TimeoutError) return false;
        throw e;
      }
    },

    minimize: () => setWindowState(context, page, 'minimized'),

    async restore(): Promise<void> {
      await setWindowState(context, page, 'normal');
      await page.bringToFront();
    },

    async close(): Promise<void> {
      await context.close();
    },
  };
}
