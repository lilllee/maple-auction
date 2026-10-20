import fs from 'node:fs';
import path from 'node:path';
import { launchAuctionBrowser, type ApiResult } from '../nexon/browser.js';

const dataDir = path.resolve(process.cwd(), 'data');
const profileDir = path.join(dataDir, 'browser-profile');
const samplesDir = path.join(dataDir, 'samples');

const SEARCH_URL_SUFFIX = '/v1/market/web/items/searches/tool-tip';

function save(name: string, value: unknown): void {
  fs.writeFileSync(path.join(samplesDir, `${name}.json`), JSON.stringify(value, null, 2), 'utf8');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 응답이 배열이거나 { worlds } / { gameWorlds } 형태일 때 목록을 꺼낸다. */
function toList(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (isRecord(data)) {
    if (Array.isArray(data.worlds)) return data.worlds;
    if (Array.isArray(data.gameWorlds)) return data.gameWorlds;
  }
  return null;
}

/** 목록 첫 항목에서 id를 꺼낸다. 형태를 모르므로 본 키를 로그로 남긴다. */
function firstId(label: string, data: unknown, primaryKey: string): string | null {
  const list = toList(data);
  if (!list || list.length === 0) {
    console.warn(`경고: ${label} 응답이 비어 있거나 목록 형태가 아닙니다. 저장된 샘플을 확인해 주세요.`);
    return null;
  }
  const first = list[0];
  if (!isRecord(first)) {
    console.warn(`경고: ${label} 첫 항목이 객체가 아닙니다.`);
    return null;
  }
  console.log(`${label} 첫 항목의 키: ${Object.keys(first).join(', ')}`);
  const id = first[primaryKey] ?? first.id;
  if (typeof id !== 'string' && typeof id !== 'number') {
    console.warn(`경고: ${label} 첫 항목에서 ${primaryKey}/id를 찾지 못했습니다.`);
    return null;
  }
  return String(id);
}

function printChecklist(items: Array<[string, boolean]>): boolean {
  for (const [label, ok] of items) console.log(`${ok ? '✔' : '✘'} ${label}`);
  console.log(`샘플 저장 위치: ${samplesDir}`);
  return items.every(([, ok]) => ok);
}

async function main(): Promise<number> {
  fs.mkdirSync(samplesDir, { recursive: true });
  const browser = await launchAuctionBrowser(profileDir);
  try {
    let sessionOk = await browser.waitForSession(20000);
    const title = await browser.page.title();
    if (title !== 'Maple Auction') {
      console.error(`옥션 페이지 대신 차단/오류 페이지가 열렸습니다 (제목: ${title})`);
      printChecklist([
        ['페이지 열림(403 아님)', false],
        ['세션 OK', false],
        ['검색 캡처', false],
        ['최소화 상태 API OK', false],
      ]);
      return 1;
    }
    if (!sessionOk) {
      console.log('브라우저 창에서 넥슨 로그인(OTP)을 끝내 주세요. 끝나면 자동으로 이어집니다.');
      sessionOk = await browser.waitForSession(0);
    }

    // 계정/월드/캐릭터 조회
    const dailyLimit = await browser.apiFetch<unknown>('GET', '/v1/market/web/daily-limit');
    save('daily-limit', dailyLimit);
    const accounts = await browser.apiFetch<unknown>('GET', '/v1/accounts');
    save('accounts', accounts);
    save('headers', browser.apiHeaders());

    const accountId = firstId('계정', accounts.data, 'accountId');
    if (accountId) {
      const worlds = await browser.apiFetch<unknown>('GET', `/v1/accounts/${accountId}/gameWorlds`);
      save('game-worlds', worlds);
      const worldId = firstId('월드', worlds.data, 'worldId');
      if (worldId) {
        const characters = await browser.apiFetch<unknown>(
          'GET',
          `/v1/accounts/${accountId}/gameWorlds/${worldId}/characters`,
        );
        save('characters', characters);
      }
    }

    // 검색 캡처
    await browser.restore();
    const searchPromise = browser.page.waitForResponse(
      (r) => r.url().endsWith(SEARCH_URL_SUFFIX) && r.request().method() === 'POST',
      { timeout: 0 },
    );
    console.log(
      '이제 브라우저에서 조건검색 탭에 .env.example과 똑같은 조건(에테르넬 나이트헬름, 레전드리, 합산, 스킬 재사용 대기시간 감소 2, STR %증가 9, 가격 낮은 순)을 넣고 검색을 한 번 눌러 주세요.',
    );
    const response = await searchPromise;
    save('search-request', JSON.parse(response.request().postData() ?? 'null'));
    const searchResult: ApiResult<unknown> = {
      status: response.status(),
      data: await response.json().catch(() => null),
    };
    save('search-response', searchResult);

    // 최소화 상태 확인
    await browser.minimize();
    const minimized = await browser.apiFetch<unknown>('GET', '/v1/market/web/daily-limit');
    save('daily-limit-minimized', minimized);

    const allOk = printChecklist([
      ['페이지 열림(403 아님)', true],
      ['세션 OK', sessionOk],
      ['검색 캡처', searchResult.status === 200],
      ['최소화 상태 API OK', minimized.status === 200],
    ]);
    return allOk ? 0 : 1;
  } finally {
    await browser.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`오류: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
