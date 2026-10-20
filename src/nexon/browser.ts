import { chromium, errors } from 'playwright';
import type { BrowserContext, Page, Request } from 'playwright';

export const AUCTION_ORIGIN = 'https://auction.maplestory.nexon.com';
export const API_BASE = 'https://api.mskr.nexon.com';

export const SESSION_READY_PATH = '/v1/market/web/daily-limit';
export const SESSION_POLL_MS = 5000;
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

export function isSessionReadyStatus(status: number): boolean {
  return status >= 200 && status <= 299;
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

export function mergeCapturedHeaders(
  prev: Record<string, string>,
  picked: Record<string, string>,
): Record<string, string> {
  return Object.keys(picked).length > 0 ? { ...prev, ...picked } : prev;
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

export interface LaunchOptions {
  onApiResponse?: (line: string) => void;
}

export async function launchAuctionBrowser(
  profileDir: string,
  opts?: LaunchOptions,
): Promise<AuctionBrowser> {
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
    locale: 'ko-KR',
  });
  const page = context.pages()[0] ?? (await context.newPage());

  let captured: Record<string, string> = {};
  page.on('request', (request: Request) => {
    if (!isApiRequest(request.url())) return;
    captured = mergeCapturedHeaders(captured, pickApiHeaders(request.headers()));
  });

  const onApiResponse = opts?.onApiResponse;
  if (onApiResponse) {
    page.on('response', (res) => {
      if (!isApiRequest(res.url())) return;
      onApiResponse(`[api] ${res.request().method()} ${new URL(res.url()).pathname} -> ${res.status()}`);
    });
  }

  async function apiFetch<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResult<T>> {
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
  }

  return {
    page,
    apiHeaders: () => ({ ...captured }),
    apiFetch,

    async waitForSession(timeoutMs: number): Promise<boolean> {
      const start = Date.now();
      const deadline = timeoutMs > 0 ? start + timeoutMs : Infinity;
      try {
        await page.goto(AUCTION_ORIGIN + '/buy', {
          waitUntil: 'domcontentloaded',
          timeout: timeoutMs,
        });
      } catch (e) {
        if (e instanceof errors.TimeoutError) return false;
        throw e;
      }
      for (;;) {
        try {
          if (new URL(page.url()).origin === AUCTION_ORIGIN && Object.keys(captured).length > 0) {
            const res = await apiFetch('GET', SESSION_READY_PATH);
            if (isSessionReadyStatus(res.status)) return true;
          }
        } catch {
          // 페이지 이동 중이거나 헤더 미캡처 등: 계속 폴링한다.
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        await new Promise((r) => setTimeout(r, Math.min(SESSION_POLL_MS, remaining)));
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
