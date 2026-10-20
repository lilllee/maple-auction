# 메이플 옥션 매물 감시기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `.env`에 적은 조건으로 메이플 옥션을 주기 검색하고, 가격 하위 3건이 바뀌면 카카오톡 "나에게 보내기"로 알리는 Windows용 CLI 프로그램.

**Architecture:** Playwright가 띄운 Chromium 창(persistent profile, 항상 headed, 평소 최소화) 안에서 `fetch`를 실행해 넥슨 옥션 JSON API를 호출한다. 순수 모듈(설정 파싱, 필터 변환, 매물 정규화, 변경 감지, 메시지 포맷, 카카오 토큰)은 모두 단위 테스트하고, 브라우저와 네트워크를 만지는 얇은 모듈은 `npm run spike` / `npm run search:once` 같은 수동 명령으로 확인한다. 감시 루프는 의존성 주입으로 가짜 검색/알림을 넣어 테스트한다.

**Tech Stack:** Node.js LTS, TypeScript(`tsx`로 실행, 빌드 없음), Playwright(Chromium), dotenv, vitest. HTTP는 Node 내장 `fetch`.

**Spec:** `docs/superpowers/specs/2026-10-19-maple-auction-watcher-design.md`

## Global Constraints

- 실행 대상은 Windows PC, 개발과 테스트는 리눅스. 코드는 양쪽에서 돌아야 한다. 경로는 `node:path`로만 다루고, npm 스크립트에 셸 전용 문법(`&&` 체인, `$VAR`, `rm`)을 쓰지 않는다.
- `.env`는 CRLF여도 읽혀야 한다.
- 넥슨 비밀번호, OTP, 쿠키를 `.env`나 저장소에 넣지 않는다. 쿠키는 `data/browser-profile/` 안에만 있다.
- 검색은 하루 100회 한도 안에서만. 검색 사이 5초 이상. 한 주기에 검색 요청은 1번(1페이지)만.
- 카카오 text 템플릿 `text`는 200자 이하. 길이는 `Array.from(s).length`로 센다.
- 브라우저는 항상 headed로 띄우고 세션 확인 후 CDP로 최소화한다. headless 금지.
- 상태, 토큰, 브라우저 프로필, 샘플은 모두 `./data/` 아래. `.gitignore`에 `data/`, `.env`, `node_modules/`, `.omc/`.
- API 기본 주소 `https://api.mskr.nexon.com`, 공통 헤더 `X-Platform`, `x-client-version`, `X-Device-Id`는 앱이 보낸 실제 요청에서 캡처해 재사용한다.
- 모든 사용자 노출 문구(터미널, 카카오톡)는 한국어.

## Review Focus

- `.env`가 CRLF이거나 값 앞뒤에 공백, 파일 첫머리에 BOM이 있어도 조건이 그대로 읽혀야 한다. → Task 1 `loadConfig` 테스트.
- 잠재등급을 `레전더리`로 적거나 옵션 라벨의 공백이 다르게 들어와도(`STR  %증가`) 같은 코드로 맞춰야 한다. → Task 1 `findGradeCode`/`findOptionCode` 테스트.
- 검색 결과가 0건, 1건, 2건이거나 같은 가격이 여럿이어도 순번(`[1/2]`)과 지문이 안정적이어야 한다. → Task 6 `topN`/`fingerprint`, Task 7 `formatListingMessage` 테스트.
- 툴팁에 에디셔널이 없거나 잠재 줄이 매우 길어도 메시지가 200자 이하이고 `undefined`/`null` 문자열이 섞이지 않아야 한다. → Task 7 테스트.
- 근무 중 카카오 access token이 만료돼 401이 오면 1번 갱신 후 재시도하고, 갱신마저 실패하면 루프를 죽이지 않고 터미널에만 알려야 한다. → Task 8 `sendToMe`, Task 9 `runCycle` 테스트.

---

## 파일 구조

```
package.json, tsconfig.json, .gitignore, .env.example, README.md
src/
  config.ts              .env → AppConfig (검증, 한국어 오류)
  nexon/options.ts       라벨↔코드 표: 잠재옵션, 에디셔널, 등급, 월드
  nexon/browser.ts       Playwright persistent context, 헤더 캡처, 페이지 내 fetch, 최소화/복원, 세션 대기
  nexon/filters.ts       SearchSpec + Selection → 검색 요청 본문
  nexon/listing.ts       검색 응답 → Listing[] (정규화)
  nexon/api.ts           daily-limit, accounts/gameWorlds/characters, 검색 호출, 세션 오류 변환
  watch/fingerprint.ts   topN, fingerprint
  watch/state.ts         data/state.json 읽고 쓰기
  watch/loop.ts          runCycle, startLoop (의존성 주입)
  kakao/auth.ts          OAuth 코드 교환, 갱신, 토큰 파일
  kakao/send.ts          text 템플릿, 나에게 보내기, Notifier
  format.ts              메시지 문구와 200자 규칙
  cli/spike.ts           0단계 검증 + 샘플 캡처
  cli/start.ts           npm start
  cli/search-once.ts     npm run search:once
  cli/kakao-auth.ts      npm run kakao:auth
  cli/kakao-test.ts      npm run kakao:test
tests/
  *.test.ts, fixtures/   (search-request.json, search-response.json 등 스파이크에서 가져온 샘플)
```

---

### Task 1: 프로젝트 뼈대와 설정 파싱

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`
- Create: `src/nexon/options.ts`, `src/config.ts`
- Test: `tests/options.test.ts`, `tests/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/nexon/options.ts
  export type GradeCode = 'all' | 'none' | 'rare' | 'epic' | 'unique' | 'legendary';
  export interface OptionEntry { label: string; code: string }
  export const POTENTIAL_OPTIONS: readonly OptionEntry[];            // 39개, 아래 표
  export const ADDITIONAL_POTENTIAL_OPTIONS: readonly OptionEntry[]; // 36개, 아래 표
  export const GRADES: readonly { label: string; code: GradeCode }[]; // 전체/없음/레어/에픽/유니크/레전드리
  export const WORLDS: readonly { id: number; name: string }[];
  export function normalizeLabel(s: string): string;                 // trim + 연속 공백 1개로
  export function findOptionCode(label: string, table: readonly OptionEntry[]): string | null;
  export function findGradeCode(label: string): GradeCode | null;    // '레전더리'도 legendary
  export function findWorldId(name: string): number | null;

  // src/config.ts
  export interface OptionRow { code: string; label: string; min: number }
  export interface SearchSpec {
    itemName: string; exactMatch: boolean;
    potentialGrade: GradeCode; potentialSum: boolean; potentialOptions: OptionRow[];
    additionalPotentialGrade: GradeCode; additionalPotentialSum: boolean; additionalPotentialOptions: OptionRow[];
    starforceMin: number | null; starforceMax: number | null; priceMax: number | null;
  }
  export interface AppConfig {
    search: SearchSpec;
    worldName: string | null; characterName: string | null;
    intervalMinutes: number; topN: number; minRemainingSearches: number;
    kakao: { restApiKey: string; clientSecret: string | null; redirectPort: number };
    dataDir: string;   // path.resolve(process.cwd(), 'data')
  }
  export class ConfigError extends Error {}
  export function parseOptionRows(raw: string, table: readonly OptionEntry[]): OptionRow[]; // "라벨:숫자, 라벨:숫자"
  export function loadConfig(env: Record<string, string | undefined>): AppConfig;  // 잘못되면 ConfigError
  export function readEnvFile(file: string): Record<string, string>;  // dotenv.parse + BOM 제거
  ```

옵션 표 (라벨 | 코드). 잠재옵션 39개:

```
보스 몬스터 데미지 % 증가|bossDamagePercent  몬스터 방어율 무시|ignoreMonsterDefense  데미지 %증가|damagePercent
공격력 %증가|physicalAttackPercent  마력 %증가|magicAttackPercent  올스탯 %증가|allStatsPercent
STR %증가|strPercent  DEX %증가|dexPercent  INT %증가|intPercent  LUK %증가|lukPercent
크리티컬 확률 증가|criticalPercent  상태 이상 내성 증가|statusResistance  모든 속성 내성 증가|elementalResistance
크리티컬 데미지 증가|criticalDamagePercent  스킬 재사용 대기시간 감소|skillCooldownReduction
아이템 획득 확률 증가|itemDropPercent  최대 HP %증가|maxHpPercent  최대 MP %증가|maxMpPercent
공격력 증가|physicalAttack  마력 증가|magicAttack
<쓸만한 헤이스트> 스킬|hasteSkill  <쓸만한 미스틱 도어> 스킬|mysticDoorSkill  <쓸만한 샤프 아이즈> 스킬|sharpEyesSkill
<쓸만한 하이퍼 바디> 스킬|hyperBodySkill  <쓸만한 컴뱃 오더스> 스킬|combatOrdersSkill
<쓸만한 어드밴스드 블레스> 스킬|advancedBlessSkill  <쓸만한 윈드 부스터> 스킬|windBoosterSkill
STR 증가|str  DEX 증가|dex  INT 증가|int  LUK 증가|luk  최대 HP 증가|maxHp  최대 MP 증가|maxMp  올스탯 증가|allStats
4차 이하 스킬 레벨 증가|skillLevelIncrease  공격 시 HP 회복|hpRecovery  공격 시 MP 회복|mpRecovery
HP 회복 아이템 및 스킬 효율 증가|hpRecoveryRate  메소 획득량 증가|mesosObtainedPercent
```

에디셔널 36개: 위 표에서 `<쓸만한 ...> 스킬` 7개를 빼고, `STR 증가|str` 뒤 묶음에 다음 4개를 더한다.
`캐릭터 9레벨 당 STR 증가|strPerLevel  캐릭터 9레벨 당 DEX 증가|dexPerLevel  캐릭터 9레벨 당 INT 증가|intPerLevel  캐릭터 9레벨 당 LUK 증가|lukPerLevel`

월드 표: 스카니아 0, 베라 1, 루나 3, 제니스 4, 크로아 5, 유니온 10, 엘리시움 16, 이노시스 29, 레드 43, 오로라 44, 아케인 50, 노바 51, 에오스 45, 헬리오스 46, 챌린저스 49, 챌린저스2 48, 챌린저스3 52, 챌린저스4 54.

- [ ] **Step 1: 뼈대 파일 작성**

`package.json`: `"type": "module"`, scripts `start: tsx src/cli/start.ts`, `spike: tsx src/cli/spike.ts`, `search:once: tsx src/cli/search-once.ts`, `kakao:auth: tsx src/cli/kakao-auth.ts`, `kakao:test: tsx src/cli/kakao-test.ts`, `test: vitest run`, `typecheck: tsc --noEmit`. deps: `playwright`, `dotenv`. devDeps: `typescript`, `tsx`, `vitest`, `@types/node`. engines `node >=18.18`.
`tsconfig.json`: `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2022`, `strict: true`, `noEmit: true`, `include: ["src", "tests"]`.
`.env.example`: 스펙 6절의 내용 그대로. `KAKAO_CLIENT_SECRET=` 줄을 추가한다(비워도 됨).
`.gitignore`: `node_modules/`, `data/`, `.env`, `.omc/`.

- [ ] **Step 2: 설치**

Run: `npm install`
Expected: `node_modules/` 생성, 오류 없음. (Chromium 다운로드는 여기서 하지 않는다.)

- [ ] **Step 3: options 실패 테스트 작성**

`tests/options.test.ts`:
```ts
test('표 크기', () => { expect(POTENTIAL_OPTIONS).toHaveLength(39); expect(ADDITIONAL_POTENTIAL_OPTIONS).toHaveLength(36); expect(WORLDS).toHaveLength(18); });
test('라벨 공백 차이를 무시하고 코드를 찾는다', () => {
  expect(findOptionCode('STR  %증가 ', POTENTIAL_OPTIONS)).toBe('strPercent');
  expect(findOptionCode('스킬 재사용 대기시간 감소', POTENTIAL_OPTIONS)).toBe('skillCooldownReduction');
  expect(findOptionCode('캐릭터 9레벨 당 STR 증가', POTENTIAL_OPTIONS)).toBeNull();
  expect(findOptionCode('캐릭터 9레벨 당 STR 증가', ADDITIONAL_POTENTIAL_OPTIONS)).toBe('strPerLevel');
});
test('등급 별칭', () => { expect(findGradeCode('레전드리')).toBe('legendary'); expect(findGradeCode('레전더리')).toBe('legendary'); expect(findGradeCode('전체')).toBe('all'); expect(findGradeCode('신화')).toBeNull(); });
test('월드', () => { expect(findWorldId('스카니아')).toBe(0); expect(findWorldId('챌린저스4')).toBe(54); expect(findWorldId('없는월드')).toBeNull(); });
```

- [ ] **Step 4: 실패 확인**

Run: `npx vitest run tests/options.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 5: `src/nexon/options.ts` 구현**

표는 위 순서 그대로 배열 리터럴로. `normalizeLabel`은 `trim()` 후 `/\s+/g → ' '`.

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/options.test.ts`
Expected: PASS

- [ ] **Step 7: config 실패 테스트 작성**

`tests/config.test.ts` (env 객체를 직접 넘긴다):
```ts
const base = { ITEM_NAME: '에테르넬 나이트헬름', POTENTIAL_GRADE: '레전드리', POTENTIAL_SUM: 'true',
  POTENTIAL_OPTIONS: '스킬 재사용 대기시간 감소:2, STR %증가:9', KAKAO_REST_API_KEY: 'k' };
test('예시 조건을 파싱한다', () => {
  const c = loadConfig(base);
  expect(c.search.potentialOptions).toEqual([
    { code: 'skillCooldownReduction', label: '스킬 재사용 대기시간 감소', min: 2 },
    { code: 'strPercent', label: 'STR %증가', min: 9 }]);
  expect(c.search.potentialGrade).toBe('legendary'); expect(c.search.exactMatch).toBe(true);
  expect(c.intervalMinutes).toBe(15); expect(c.topN).toBe(3); expect(c.minRemainingSearches).toBe(10);
  expect(c.kakao.redirectPort).toBe(3131); expect(c.worldName).toBeNull();
});
test('모르는 라벨이면 ConfigError에 라벨 목록이 들어간다', () => {
  expect(() => loadConfig({ ...base, POTENTIAL_OPTIONS: '쿨감:2' })).toThrow(/쿨감/);
  expect(() => loadConfig({ ...base, POTENTIAL_OPTIONS: '쿨감:2' })).toThrow(/스킬 재사용 대기시간 감소/);
});
test('필수값 누락', () => {
  expect(() => loadConfig({ ...base, ITEM_NAME: '' })).toThrow(ConfigError);
  expect(() => loadConfig({ ...base, KAKAO_REST_API_KEY: undefined })).toThrow(ConfigError);
  expect(() => loadConfig({ ...base, INTERVAL_MINUTES: '0' })).toThrow(ConfigError);
  expect(() => loadConfig({ ...base, POTENTIAL_OPTIONS: 'STR %증가:abc' })).toThrow(ConfigError);
});
test('CRLF, BOM, 앞뒤 공백이 있는 .env 파일을 읽는다', () => {
  const file = path.join(os.tmpdir(), `env-${Date.now()}`);
  fs.writeFileSync(file, '﻿ITEM_NAME= 에테르넬 나이트헬름 \r\nPOTENTIAL_OPTIONS=STR %증가:9\r\n');
  const env = readEnvFile(file);
  expect(env.ITEM_NAME).toBe('에테르넬 나이트헬름'); expect(env.POTENTIAL_OPTIONS).toBe('STR %증가:9');
});
```

- [ ] **Step 8: 실패 확인**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL

- [ ] **Step 9: `src/config.ts` 구현**

기본값: `ITEM_EXACT_MATCH=true`, `POTENTIAL_GRADE=all`, `POTENTIAL_SUM=false`, `ADDITIONAL_*` 같은 규칙, `INTERVAL_MINUTES=15`, `TOP_N=3`, `MIN_REMAINING_SEARCHES=10`, `KAKAO_REDIRECT_PORT=3131`. 빈 문자열은 "없음"으로 본다. 숫자는 `Number()` 후 유한하고 양수인지 검사. `ConfigError` 메시지 형식: `"[설정 오류] POTENTIAL_OPTIONS: '쿨감'은 모르는 옵션입니다. 가능한 값: 보스 몬스터 데미지 % 증가, ..."`.

- [ ] **Step 10: 통과 확인**

Run: `npx vitest run` 와 `npm run typecheck`
Expected: 모두 PASS

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .env.example src/nexon/options.ts src/config.ts tests/
git commit -m "feat: 프로젝트 뼈대와 .env 설정 파싱"
```

---

### Task 2: 브라우저 세션 모듈

**Files:**
- Create: `src/nexon/browser.ts`
- Test: `tests/browser.test.ts` (순수 함수만)

**Interfaces:**
- Produces:
  ```ts
  export const AUCTION_ORIGIN = 'https://auction.maplestory.nexon.com';
  export const API_BASE = 'https://api.mskr.nexon.com';
  export interface ApiResult<T> { status: number; data: T | null }
  export interface AuctionBrowser {
    page: Page;
    apiHeaders(): Record<string, string>;          // 캡처된 x-device-id, x-platform, x-client-version
    apiFetch<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResult<T>>;
    waitForSession(timeoutMs: number): Promise<boolean>; // /buy로 이동, web-token/session 200 기다림. 0이면 무한
    minimize(): Promise<void>; restore(): Promise<void>;
    close(): Promise<void>;
  }
  export function isApiRequest(url: string): boolean;                       // API_BASE로 시작
  export function pickApiHeaders(h: Record<string, string>): Record<string, string>; // 소문자 키 3개만
  export async function launchAuctionBrowser(profileDir: string): Promise<AuctionBrowser>;
  ```

- [ ] **Step 1: 순수 함수 실패 테스트**

```ts
test('isApiRequest', () => { expect(isApiRequest('https://api.mskr.nexon.com/v1/x')).toBe(true); expect(isApiRequest('https://auction.maplestory.nexon.com/buy')).toBe(false); });
test('pickApiHeaders는 3개 헤더만 남긴다', () => {
  expect(pickApiHeaders({ 'x-device-id': 'd', 'x-platform': 'PC_WEB', 'x-client-version': '1.0.2', cookie: 'c', accept: '*/*' }))
    .toEqual({ 'x-device-id': 'd', 'x-platform': 'PC_WEB', 'x-client-version': '1.0.2' });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/browser.test.ts` Expected: FAIL

- [ ] **Step 3: `src/nexon/browser.ts` 구현**

- `launchAuctionBrowser`: `chromium.launchPersistentContext(profileDir, { headless: false, viewport: null, locale: 'ko-KR' })`. 첫 페이지를 쓴다. `page.on('request')`에서 `isApiRequest`이면 `pickApiHeaders(request.headers())`로 헤더를 갱신해 보관한다.
- `apiFetch`: `page.evaluate`로 페이지 안에서 `fetch(API_BASE + path, { method, headers: {...apiHeaders, 'content-type': 'application/json'}, body, credentials: 'include' })` 실행. 응답은 `{status, data: await res.json().catch(() => null)}`.
- `waitForSession`: `page.waitForResponse(r => r.url().includes('/v1/auth/web-token/session'), { timeout })` 프라미스를 먼저 만들어 둔 뒤 `page.goto(AUCTION_ORIGIN + '/buy')`를 호출한다(응답을 놓치는 경쟁 방지). status 200이 오면 true, 아니면 다음 응답을 다시 기다린다. timeout이면 false. `timeoutMs === 0`이면 200이 올 때까지 반복(로그인 대기).
- `apiFetch`는 캡처된 헤더가 아직 없으면 `Error('API 헤더를 아직 캡처하지 못했습니다. 옥션 페이지가 열렸는지 확인하세요.')`를 던진다.
- `minimize`/`restore`: `context.newCDPSession(page)` → `Browser.getWindowForTarget` → `Browser.setWindowBounds({ windowId, bounds: { windowState: 'minimized' | 'normal' } })`. `restore` 뒤 `page.bringToFront()`.

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/browser.test.ts && npm run typecheck` Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/nexon/browser.ts tests/browser.test.ts
git commit -m "feat: Playwright 옥션 브라우저 세션 모듈"
```

---

### Task 3: 스파이크 명령과 샘플 캡처 (0단계 검증, 사용자 실행)

**Files:**
- Create: `src/cli/spike.ts`
- Create (사용자 실행 후): `tests/fixtures/search-request.json`, `tests/fixtures/search-response.json`, `tests/fixtures/accounts.json`, `tests/fixtures/game-worlds.json`, `tests/fixtures/characters.json`, `tests/fixtures/daily-limit.json`

**Interfaces:**
- Consumes: Task 2 `launchAuctionBrowser`, `waitForSession`, `apiFetch`, `minimize`.

- [ ] **Step 1: `src/cli/spike.ts` 작성**

순서:
1. `.env` 없이도 돌아야 하므로 `loadConfig`를 쓰지 않고 `dataDir = path.resolve(process.cwd(), 'data')`로 잡는다. `launchAuctionBrowser(path.join(dataDir, 'browser-profile'))`. `waitForSession(20000)`이 false면 `"브라우저 창에서 넥슨 로그인(OTP)을 끝내 주세요. 끝나면 자동으로 이어집니다."` 출력 후 `waitForSession(0)`.
2. `apiFetch('GET', '/v1/market/web/daily-limit')`, `GET /v1/accounts`, 첫 계정으로 `GET /v1/accounts/{id}/gameWorlds`, 첫 월드로 `GET /v1/accounts/{id}/gameWorlds/{worldId}/characters`. 각 결과를 `data/samples/<이름>.json`에 저장. 캡처된 헤더도 `data/samples/headers.json`에 저장.
3. 출력: `"이제 브라우저에서 조건검색 탭에 .env.example과 똑같은 조건(에테르넬 나이트헬름, 레전드리, 합산, 스킬 재사용 대기시간 감소 2, STR %증가 9, 가격 낮은 순)을 넣고 검색을 한 번 눌러 주세요."` 그리고 `page.waitForResponse(r => r.url().endsWith('/v1/market/web/items/searches/tool-tip') && r.request().method() === 'POST', { timeout: 0 })`. 요청 본문 `JSON.parse(request.postData())`을 `search-request.json`, 응답을 `search-response.json`에 저장.
4. `minimize()` 후 다시 `GET /v1/market/web/daily-limit` 호출, 결과 status를 기록.
5. 체크리스트 출력: `페이지 열림(403 아님)`, `세션 OK`, `검색 캡처`, `최소화 상태 API OK` 각각 `✔`/`✘`. 하나라도 ✘면 종료 코드 1.
6. `close()`.

- [ ] **Step 2: 타입 검사** — Run: `npm run typecheck` Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/spike.ts
git commit -m "feat: 0단계 검증용 spike 명령"
```

- [ ] **Step 4: (사용자) Windows PC에서 실행**

구현자는 여기서 멈추고 사용자에게 넘긴다. 사용자가 할 일:
1. 저장소를 Windows PC로 옮긴다(git remote에 push하거나 폴더 복사. 방법은 사용자 선택).
2. Node.js LTS 설치 → `npm install` → `npx playwright install chromium`.
3. `npm run spike` 실행, 안내대로 로그인과 검색 1회.
4. 체크리스트 4개가 모두 ✔인지 확인. ✘가 있으면 설계로 돌아간다(스펙 9절 0단계).

Expected: 체크리스트 4개 ✔, `data/samples/*.json` 생성.

- [ ] **Step 5: (사용자+구현자) 샘플을 fixture로 가져오기**

`data/samples/*.json`을 리눅스 저장소의 `tests/fixtures/`로 복사한다. 복사본에서 `accountId`, `characterId`, `characterName`, `nexonSn` 같은 계정 식별 값은 `"ACC1"`, `"CHAR1"`, `"테스트캐릭"` 처럼 바꾸되 두 파일(search-request, characters)에서 같은 값으로 바꾼다. `headers.json`은 가져오지 않는다.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/
git commit -m "test: 스파이크에서 캡처한 API 샘플 fixture"
```

---

### Task 4: 검색 요청 본문 만들기

**Files:**
- Create: `src/nexon/filters.ts`
- Test: `tests/filters.test.ts`

**Interfaces:**
- Consumes: Task 1 `SearchSpec`; `tests/fixtures/search-request.json`.
- Produces:
  ```ts
  export interface Selection { accountId: string; worldId: number; characterId: string; worldName: string; characterName: string }
  export type SearchRequestBody = Record<string, unknown>;
  export const SORT_PRICE_PER_ITEM_ASC = 'PRICE_PER_ITEM_ASC';
  export function buildSearchRequest(spec: SearchSpec, sel: Selection, opts?: { page?: number; limit?: number }): SearchRequestBody;
  ```

- [ ] **Step 1: 실패 테스트 작성**

```ts
const fixture = JSON.parse(fs.readFileSync('tests/fixtures/search-request.json', 'utf8'));
const spec = loadConfig(readEnvFile('.env.example')).search;
const sel = { accountId: fixture.accountId, worldId: fixture.worldId, characterId: fixture.characterId, worldName: '', characterName: '' };
test('예시 조건으로 만든 본문이 캡처한 본문과 같다', () => {
  expect(buildSearchRequest(spec, sel)).toEqual({ ...fixture, saveRecentKeyword: false });
});
test('합산을 끄면 optionRows가 개별 옵션 형태로 들어간다', () => {
  const body = buildSearchRequest({ ...spec, potentialSum: false }, sel) as any;
  expect(JSON.stringify(body)).not.toContain('potentialOptionSum');
});
test('page와 limit 옵션', () => {
  const body = buildSearchRequest(spec, sel, { page: 2 }) as any;
  expect(body.page).toBe(2); expect(body.limit).toBe(20); expect(body.sortType).toBe(SORT_PRICE_PER_ITEM_ASC);
});
```
첫 테스트가 핵심이다. 캡처된 본문의 `page`, `limit`, `sortType`, `keyword`, `isExactMatch`, `filters` 구조를 그대로 재현한다. `saveRecentKeyword`만 항상 `false`.

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/filters.test.ts` Expected: FAIL

- [ ] **Step 3: `src/nexon/filters.ts` 구현**

fixture를 열어 구조를 보고, 스펙 4.1의 필터 키(`enhancementOption::potentialGrade`, `...potentialFilters::isAddAll`, `...optionRows: [{value, min}]`, 에디셔널 동형, `starforceMin/Max`, `price::max`) 또는 서버 전송 형태(`enhancementOption.potentialOptionSum` 등) 중 fixture에 실제로 있는 쪽을 만든다. 조건이 비어 있을 때의 기본값(`""`, `[{value:"none",min:""}]`, `"all"`)은 fixture에 보이는 값을 따른다. `min`은 fixture와 같은 타입(문자열이면 `String(n)`).

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/filters.test.ts` Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/nexon/filters.ts tests/filters.test.ts
git commit -m "feat: 검색 조건을 옥션 API 요청 본문으로 변환"
```

---

### Task 5: 매물 정규화와 API 클라이언트

**Files:**
- Create: `src/nexon/listing.ts`, `src/nexon/api.ts`
- Test: `tests/listing.test.ts`

**Interfaces:**
- Consumes: Task 2 `AuctionBrowser`, Task 4 `Selection`, `SearchRequestBody`; `tests/fixtures/search-response.json`, `accounts.json`, `game-worlds.json`, `characters.json`.
- Produces:
  ```ts
  // listing.ts
  export interface Listing {
    tradeSn: string; itemName: string; pricePerItem: number; quantity: number;
    starforce: number | null; potentialGrade: string | null; potentialLines: string[];
    additionalGrade: string | null; additionalLines: string[]; remainUpgradeCount: number | null;
    extras: string[];   // 그 밖의 툴팁 한 줄 정보(예: 업그레이드 횟수 이외의 짧은 텍스트). 없으면 []
  }
  export function listingsFromResponse(resp: unknown): Listing[];  // resp.items[] → normalizeListing
  export function normalizeListing(raw: unknown): Listing;         // 필드 없으면 null/[]; 절대 'undefined' 문자열 없음

  // api.ts
  export class SessionExpiredError extends Error {}
  export class ApiError extends Error { constructor(message: string, public status: number) }
  export async function getDailyLimit(b: AuctionBrowser): Promise<{ remaining: number; limit: number }>;
  export async function resolveSelection(b: AuctionBrowser, cfg: { worldName: string | null; characterName: string | null }): Promise<Selection>;
  export async function searchListings(b: AuctionBrowser, body: SearchRequestBody): Promise<Listing[]>;
  export function toApiError(status: number, data: unknown): SessionExpiredError | ApiError; // 401/426 → SessionExpiredError
  ```

- [ ] **Step 1: 실패 테스트 작성**

```ts
const resp = JSON.parse(fs.readFileSync('tests/fixtures/search-response.json', 'utf8'));
test('fixture의 매물을 정규화한다', () => {
  const list = listingsFromResponse(resp);
  expect(list.length).toBe(resp.items.length);
  const first = list[0];
  expect(first.tradeSn).toBe(String(resp.items[0].tradeSn));
  expect(first.itemName).toBe('에테르넬 나이트헬름');
  expect(first.pricePerItem).toBeGreaterThan(0);
  expect(first.potentialGrade).toBe('레전드리');
  expect(first.potentialLines.length).toBeGreaterThanOrEqual(1);
  expect(first.potentialLines.join(' ')).toMatch(/재사용 대기시간|STR/);
});
test('툴팁이 비어 있어도 안전한 기본값', () => {
  const l = normalizeListing({ tradeSn: 1, pricePerItem: 5, quantity: 1 });
  expect(l).toMatchObject({ tradeSn: '1', pricePerItem: 5, itemName: '', starforce: null, potentialGrade: null, potentialLines: [], additionalGrade: null, additionalLines: [], remainUpgradeCount: null, extras: [] });
  expect(JSON.stringify(l)).not.toContain('undefined');
});
test('toApiError', () => {
  expect(toApiError(401, { code: 5 })).toBeInstanceOf(SessionExpiredError);
  expect(toApiError(426, null)).toBeInstanceOf(SessionExpiredError);
  expect(toApiError(500, null)).toBeInstanceOf(ApiError);
});
```
`potentialGrade`와 줄 문자열의 기대값은 fixture의 첫 매물이 실제로 가진 값으로 맞춘다(위는 예시 조건으로 검색했을 때의 값).

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/listing.test.ts` Expected: FAIL

- [ ] **Step 3: `src/nexon/listing.ts` 구현**

fixture의 `items[i]`를 보고 매핑한다. 알려진 위치: `tradeSn`, `pricePerItem`, `quantity`, `toolTip.itemName`, `toolTip.starforce`, `toolTip.upgradeInfo.potential`(등급과 줄), 에디셔널은 `toolTip.upgradeInfo` 아래 이웃 키, `remainUpgradeCount`. 잠재 줄은 사람이 읽는 문장 하나당 문자열 하나(예: `"STR +9%"`). 이미 문자열이면 그대로, 객체면 라벨과 값을 붙인다.

- [ ] **Step 4: `src/nexon/api.ts` 구현**

- `getDailyLimit`: `GET /v1/market/web/daily-limit` → `data.search.remaining`, `data.search.limit`(없으면 100).
- `resolveSelection`: `GET /v1/accounts` → `GET /v1/accounts/{id}/gameWorlds` → `GET .../characters`. fixture(`accounts.json` 등)의 필드명을 따른다. `worldName`이 있으면 이름으로 고르고, 없으면 월드가 1개일 때만 자동. 캐릭터도 같은 규칙. 고를 수 없으면 `ApiError`에 가능한 이름 목록을 넣어 던진다(`"[설정 필요] WORLD_NAME을 정해 주세요. 가능한 값: 스카니아, 루나"`).
- `searchListings`: `POST /v1/market/web/items/searches/tool-tip` → status 200이면 `listingsFromResponse`, 아니면 `toApiError`.
- 모든 호출은 status ≥ 400이면 `toApiError`를 던진다.

- [ ] **Step 5: 통과 확인** — Run: `npx vitest run && npm run typecheck` Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/nexon/listing.ts src/nexon/api.ts tests/listing.test.ts
git commit -m "feat: 옥션 API 클라이언트와 매물 정규화"
```

---

### Task 6: 변경 감지와 상태 파일

**Files:**
- Create: `src/watch/fingerprint.ts`, `src/watch/state.ts`
- Test: `tests/fingerprint.test.ts`, `tests/state.test.ts`

**Interfaces:**
- Consumes: Task 5 `Listing`.
- Produces:
  ```ts
  export function topN(listings: Listing[], n: number): Listing[];   // pricePerItem 오름차순, 같으면 tradeSn 오름차순
  export function fingerprint(listings: Listing[]): string;          // `${tradeSn}:${pricePerItem}`를 '|'로. 빈 배열은 ''
  export interface WatchState { lastFingerprint: string | null; lastResultCount: number | null; limitAlertDate: string | null }
  export const EMPTY_STATE: WatchState;
  export function loadState(file: string): WatchState;   // 없거나 깨지면 EMPTY_STATE
  export function saveState(file: string, s: WatchState): void;  // 디렉터리 없으면 만든다
  ```

- [ ] **Step 1: 실패 테스트 작성**

```ts
const L = (sn: string, p: number) => ({ ...emptyListing, tradeSn: sn, pricePerItem: p });
test('topN은 가격순, 동가면 tradeSn순', () => {
  expect(topN([L('b', 10), L('a', 10), L('c', 5), L('d', 20)], 3).map(l => l.tradeSn)).toEqual(['c', 'a', 'b']);
});
test('fingerprint', () => {
  expect(fingerprint([])).toBe('');
  expect(fingerprint([L('c', 5), L('a', 10)])).toBe('c:5|a:10');
  expect(fingerprint([L('a', 10), L('c', 5)])).not.toBe(fingerprint([L('c', 5), L('a', 10)]));
});
test('state 왕복과 깨진 파일', () => {
  const f = path.join(os.tmpdir(), `st-${Date.now()}`, 'state.json');
  expect(loadState(f)).toEqual(EMPTY_STATE);
  saveState(f, { lastFingerprint: 'x', lastResultCount: 1, limitAlertDate: '2026-10-19' });
  expect(loadState(f).lastFingerprint).toBe('x');
  fs.writeFileSync(f, '{broken'); expect(loadState(f)).toEqual(EMPTY_STATE);
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/fingerprint.test.ts tests/state.test.ts` Expected: FAIL
- [ ] **Step 3: 구현** — `topN`은 입력을 복사한 뒤 정렬. `saveState`는 `fs.mkdirSync(dirname, { recursive: true })` 후 JSON 2칸 들여쓰기.
- [ ] **Step 4: 통과 확인** — Run: 같은 명령 Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add src/watch/fingerprint.ts src/watch/state.ts tests/fingerprint.test.ts tests/state.test.ts
git commit -m "feat: 상위 N건 지문과 상태 파일"
```

---

### Task 7: 메시지 문구와 200자 규칙

**Files:**
- Create: `src/format.ts`
- Test: `tests/format.test.ts`

**Interfaces:**
- Consumes: Task 1 `SearchSpec`, Task 5 `Listing`.
- Produces:
  ```ts
  export const MAX_TEXT_LENGTH = 200;
  export const BUY_PAGE_URL = 'https://auction.maplestory.nexon.com/buy';
  export function textLength(s: string): number;                 // Array.from(s).length
  export function formatMeso(n: number): string;                 // 1234567890 → '1,234,567,890 메소'
  export function formatListingMessage(l: Listing, index: number, total: number): string;
  export function formatStartMessage(spec: SearchSpec, remaining: number): string;
  export function formatNoResultsMessage(spec: SearchSpec): string;
  export function formatLoginRequiredMessage(): string;
  export function formatLimitMessage(remaining: number): string;
  export function formatFailureMessage(count: number, lastError: string): string;
  export function formatStopMessage(reason: string): string;
  ```

고정 문구:
- 시작: `[옥션 감시 시작]\n{아이템명} / {잠재등급} / {옵션 라벨 min, ...}\n오늘 남은 검색 {remaining}회`
- 매물 없음: `[옥션] 조건에 맞는 매물이 없습니다.\n{아이템명}`
- 로그인 필요: `[옥션] 로그인이 필요합니다. 회사 PC 브라우저 창에서 넥슨 로그인을 해 주세요.`
- 한도: `[옥션] 오늘 남은 검색이 {remaining}회라 검색을 멈춥니다. 내일 다시 시작합니다.`
- 연속 오류: `[옥션] 검색이 {count}번 연속 실패했습니다.\n{lastError}`
- 중단: `[옥션 감시 중단] {reason}`
- 매물: 줄 단위로 순서대로 `[{index}/{total}] {가격}`, `{itemName}`, `잠재 {등급}: {줄1} / {줄2} / {줄3}`, `에디 {등급}: ...`(등급이 null이면 줄 생략), `{starforce}성 · 업횟 {remainUpgradeCount}`(둘 다 null이면 생략), `extras` 각각 한 줄.

- [ ] **Step 1: 실패 테스트 작성**

```ts
const base: Listing = { tradeSn: '1', itemName: '에테르넬 나이트헬름', pricePerItem: 1234567890, quantity: 1, starforce: 17,
  potentialGrade: '레전드리', potentialLines: ['스킬 재사용 대기시간 -2초', 'STR +9%', 'DEX +3%'],
  additionalGrade: '유니크', additionalLines: ['STR +4%', '올스탯 +2%', '공격력 +9'], remainUpgradeCount: 0, extras: [] };
test('매물 메시지 기본 형태', () => {
  const m = formatListingMessage(base, 1, 3);
  expect(m.split('\n')[0]).toBe('[1/3] 1,234,567,890 메소');
  expect(m).toContain('에테르넬 나이트헬름');
  expect(m).toContain('잠재 레전드리: 스킬 재사용 대기시간 -2초 / STR +9% / DEX +3%');
  expect(m).toContain('에디 유니크: STR +4% / 올스탯 +2% / 공격력 +9');
  expect(m).toContain('17성 · 업횟 0');
  expect(textLength(m)).toBeLessThanOrEqual(200);
});
test('에디셔널과 스타포스가 없으면 그 줄이 빠지고 undefined가 없다', () => {
  const m = formatListingMessage({ ...base, additionalGrade: null, additionalLines: [], starforce: null, remainUpgradeCount: null }, 2, 2);
  expect(m).not.toMatch(/에디|성 ·|undefined|null/); expect(m.startsWith('[2/2]')).toBe(true);
});
test('너무 길면 뒤에서부터 잘라 200자 이하로, 가격/이름/잠재는 남긴다', () => {
  const long = { ...base, potentialLines: Array(3).fill('아주 긴 잠재 옵션 설명 문장이 여기에 들어갑니다 정말로 깁니다'), extras: ['추가 정보 1', '추가 정보 2'] };
  const m = formatListingMessage(long, 1, 1);
  expect(textLength(m)).toBeLessThanOrEqual(200);
  expect(m).toContain('1,234,567,890 메소'); expect(m).toContain('에테르넬 나이트헬름'); expect(m).toContain('잠재 레전드리');
});
test('고정 문구', () => {
  expect(formatLoginRequiredMessage()).toBe('[옥션] 로그인이 필요합니다. 회사 PC 브라우저 창에서 넥슨 로그인을 해 주세요.');
  expect(formatLimitMessage(9)).toBe('[옥션] 오늘 남은 검색이 9회라 검색을 멈춥니다. 내일 다시 시작합니다.');
  expect(formatStartMessage(spec, 96)).toBe('[옥션 감시 시작]\n에테르넬 나이트헬름 / 레전드리 / 스킬 재사용 대기시간 감소 2, STR %증가 9\n오늘 남은 검색 96회');
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/format.test.ts` Expected: FAIL

- [ ] **Step 3: `src/format.ts` 구현**

자르기 알고리즘: 줄 배열을 만든 뒤 `textLength(join) > 200`이면 마지막 줄부터 하나씩 뺀다. 단 처음 3줄(가격, 이름, 잠재)은 빼지 않는다. 그래도 넘으면 잠재 줄 끝을 `…` 포함 200자에 맞게 자른다.

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/format.test.ts` Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add src/format.ts tests/format.test.ts
git commit -m "feat: 카카오 메시지 문구와 200자 규칙"
```

---

### Task 8: 카카오 인증과 나에게 보내기

**Files:**
- Create: `src/kakao/auth.ts`, `src/kakao/send.ts`, `src/cli/kakao-auth.ts`, `src/cli/kakao-test.ts`
- Test: `tests/kakao.test.ts`

**Interfaces:**
- Consumes: Task 1 `AppConfig['kakao']`, `dataDir`; Task 7 `BUY_PAGE_URL`.
- Produces:
  ```ts
  // auth.ts
  export interface KakaoTokens { accessToken: string; refreshToken: string; accessExpiresAt: number; refreshExpiresAt: number } // epoch ms
  export const AUTHORIZE_URL = 'https://kauth.kakao.com/oauth/authorize';
  export const TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
  export function redirectUri(port: number): string;                       // `http://localhost:${port}/oauth`
  export function buildAuthorizeUrl(restApiKey: string, port: number): string; // response_type=code&scope=talk_message
  export function tokensFromResponse(json: unknown, now: number, prev?: KakaoTokens): KakaoTokens; // refresh_token 없으면 prev 유지
  export function needsRefresh(t: KakaoTokens, now: number): boolean;      // accessExpiresAt - now < 10분
  export async function exchangeCode(code: string, cfg: KakaoCfg, fetchImpl?: typeof fetch): Promise<KakaoTokens>;
  export async function refreshTokens(t: KakaoTokens, cfg: KakaoCfg, fetchImpl?: typeof fetch): Promise<KakaoTokens>;
  export function loadTokens(file: string): KakaoTokens | null;
  export function saveTokens(file: string, t: KakaoTokens): void;
  export async function runAuthFlow(cfg: KakaoCfg, tokenFile: string): Promise<KakaoTokens>; // 로컬 서버 + 브라우저 열기
  type KakaoCfg = { restApiKey: string; clientSecret: string | null; redirectPort: number };

  // send.ts
  export const SEND_URL = 'https://kapi.kakao.com/v2/api/talk/memo/default/send';
  export function buildTextTemplate(text: string, linkUrl: string): { object_type: 'text'; text: string; link: { web_url: string; mobile_web_url: string } };
  export interface Notifier { send(text: string): Promise<void> }
  export function createKakaoNotifier(cfg: KakaoCfg, tokenFile: string, fetchImpl?: typeof fetch, now?: () => number): Notifier;
  ```
  `Notifier.send`: 토큰 없으면 `Error('카카오 토큰이 없습니다. npm run kakao:auth 를 먼저 실행하세요.')`. `needsRefresh`면 갱신 후 저장. 전송이 401이면 1번 갱신하고 재시도. `result_code !== 0`이거나 2xx가 아니면 `Error`에 응답 본문을 담아 던진다. 링크는 항상 `BUY_PAGE_URL`.

- [ ] **Step 1: 실패 테스트 작성**

```ts
test('authorize url', () => {
  const u = new URL(buildAuthorizeUrl('KEY', 3131));
  expect(u.origin + u.pathname).toBe(AUTHORIZE_URL);
  expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:3131/oauth');
  expect(u.searchParams.get('scope')).toBe('talk_message'); expect(u.searchParams.get('response_type')).toBe('code');
});
test('tokensFromResponse와 needsRefresh', () => {
  const t = tokensFromResponse({ access_token: 'a', refresh_token: 'r', expires_in: 21600, refresh_token_expires_in: 5184000 }, 1_000_000);
  expect(t).toEqual({ accessToken: 'a', refreshToken: 'r', accessExpiresAt: 1_000_000 + 21600 * 1000, refreshExpiresAt: 1_000_000 + 5184000 * 1000 });
  expect(needsRefresh(t, 1_000_000)).toBe(false);
  expect(needsRefresh(t, t.accessExpiresAt - 5 * 60 * 1000)).toBe(true);
  expect(tokensFromResponse({ access_token: 'b', expires_in: 1 }, 5, t).refreshToken).toBe('r');
});
test('텍스트 템플릿', () => {
  expect(buildTextTemplate('안녕', 'https://x')).toEqual({ object_type: 'text', text: '안녕', link: { web_url: 'https://x', mobile_web_url: 'https://x' } });
});
test('send는 401이면 한 번 갱신 후 재시도한다', async () => {
  const calls: string[] = [];
  const fetchImpl = async (url: string, init: any) => {
    calls.push(url);
    if (url === SEND_URL && calls.filter(c => c === SEND_URL).length === 1) return new Response('{"msg":"expired"}', { status: 401 });
    if (url === TOKEN_URL) return new Response(JSON.stringify({ access_token: 'new', expires_in: 21600 }), { status: 200 });
    return new Response('{"result_code":0}', { status: 200 });
  };
  saveTokens(file, { accessToken: 'old', refreshToken: 'r', accessExpiresAt: now + 3600_000, refreshExpiresAt: now + 10_000_000 });
  await createKakaoNotifier(cfg, file, fetchImpl as any, () => now).send('hi');
  expect(calls).toEqual([SEND_URL, TOKEN_URL, SEND_URL]);
  expect(loadTokens(file)!.accessToken).toBe('new');
});
test('갱신도 실패하면 Error를 던진다', async () => {
  const fetchImpl = async (url: string) => url === TOKEN_URL ? new Response('{"error":"invalid_grant"}', { status: 400 }) : new Response('{}', { status: 401 });
  saveTokens(file, { accessToken: 'old', refreshToken: 'r', accessExpiresAt: now + 3600_000, refreshExpiresAt: now + 10_000_000 });
  await expect(createKakaoNotifier(cfg, file, fetchImpl as any, () => now).send('hi')).rejects.toThrow(/invalid_grant/);
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/kakao.test.ts` Expected: FAIL

- [ ] **Step 3: `auth.ts`, `send.ts` 구현**

토큰 요청은 `application/x-www-form-urlencoded`(`URLSearchParams`). `client_secret`은 값이 있을 때만 붙인다. `runAuthFlow`: `node:http` 서버를 `redirectPort`에 띄우고 `/oauth?code=`를 받으면 교환 후 `"인증 완료. 창을 닫아도 됩니다."` 응답, 서버 종료. 브라우저 열기는 `process.platform === 'win32'`면 `start "" "<url>"`, 아니면 `xdg-open`, 실패하면 URL만 출력. 전송 본문은 `template_object=` + `encodeURIComponent(JSON.stringify(...))`.

- [ ] **Step 4: CLI 작성**

`cli/kakao-auth.ts`: `loadConfig(readEnvFile('.env'))` → `runAuthFlow` → 저장 경로 출력.
`cli/kakao-test.ts`: `createKakaoNotifier(...).send('[옥션] 테스트 메시지입니다.')` → `"전송 완료"`.

- [ ] **Step 5: 통과 확인** — Run: `npx vitest run && npm run typecheck` Expected: PASS
- [ ] **Step 6: Commit**

```bash
git add src/kakao tests/kakao.test.ts src/cli/kakao-auth.ts src/cli/kakao-test.ts
git commit -m "feat: 카카오 나에게 보내기 인증과 전송"
```

---

### Task 9: 감시 루프

**Files:**
- Create: `src/watch/loop.ts`
- Test: `tests/loop.test.ts`

**Interfaces:**
- Consumes: Task 5 `Listing`, `SessionExpiredError`; Task 6 `topN`, `fingerprint`, `WatchState`; Task 7 포맷 함수들; Task 8 `Notifier`.
- Produces:
  ```ts
  export interface WatchDeps {
    search(): Promise<Listing[]>;
    getRemaining(): Promise<number>;
    notify(text: string): Promise<void>;       // 실패해도 루프를 죽이지 않는다(로그만)
    recoverSession(): Promise<boolean>;        // 페이지 새로고침으로 웹 토큰 세션 재생성 시도(최대 15초)
    onLoginRequired(): Promise<void>;          // 창 복원 → 로그인 대기 → 최소화
    now(): Date;
    state: WatchState; saveState(s: WatchState): void;
    spec: SearchSpec; topN: number; minRemainingSearches: number;
    log(msg: string): void;
  }
  export type CycleResult = 'notified' | 'unchanged' | 'limit' | 'recovered' | 'relogin' | 'failed';
  export interface LoopStatus { consecutiveFailures: number }
  export const FAILURE_ALERT_AT = 3;
  export function localDateString(d: Date): string;   // 'YYYY-MM-DD' (로컬 시간)
  export async function runCycle(deps: WatchDeps, status: LoopStatus): Promise<CycleResult>;
  export function startLoop(deps: WatchDeps, intervalMs: number): { stop(): void }; // 즉시 1회, 이후 간격마다. 겹침 방지
  ```

`runCycle` 규칙:
1. `remaining = await getRemaining()`. `remaining <= minRemainingSearches`면 `limitAlertDate !== 오늘`일 때만 `notify(formatLimitMessage)`하고 날짜 저장. `'limit'` 반환.
2. `listings = await search()`; `top = topN(listings, n)`; `fp = fingerprint(top)`.
3. `fp === state.lastFingerprint`면 `'unchanged'`. 아니면 `top.length === 0`이면 `notify(formatNoResultsMessage)`, 아니면 각 매물에 `notify(formatListingMessage(l, i+1, top.length))`. 상태 저장 후 `'notified'`. 성공하면 `consecutiveFailures = 0`.
4. `SessionExpiredError`면 먼저 `await recoverSession()`. true면 알림 없이 `'recovered'`(다음 주기에 정상 검색). false면 `notify(formatLoginRequiredMessage)` → `await onLoginRequired()` → `'relogin'`.
5. 다른 오류면 `consecutiveFailures++`; 정확히 `FAILURE_ALERT_AT`이 될 때만 `notify(formatFailureMessage)`. `'failed'`.

- [ ] **Step 1: 실패 테스트 작성**

```ts
function makeDeps(over: Partial<WatchDeps> = {}) { /* notify 호출을 sent[]에 모으고, state는 메모리, remaining 50, search는 []을 돌려주는 기본 가짜 */ }
test('결과가 바뀌면 N건 보내고 지문을 저장한다', async () => {
  const d = makeDeps({ search: async () => [L('a', 10), L('b', 20), L('c', 30), L('d', 40)] });
  expect(await runCycle(d, st)).toBe('notified');
  expect(d.sent.map(s => s.split('\n')[0])).toEqual(['[1/3] 10 메소', '[2/3] 20 메소', '[3/3] 30 메소']);
  expect(d.state.lastFingerprint).toBe('a:10|b:20|c:30');
  expect(await runCycle(d, st)).toBe('unchanged'); expect(d.sent).toHaveLength(3);
});
test('가격이 하나라도 바뀌면 3건을 다시 보낸다', async () => {
  let items = [L('a', 10), L('b', 20), L('c', 30)];
  const d = makeDeps({ search: async () => items });
  await runCycle(d, st); items = [L('a', 10), L('b', 15), L('c', 30)];
  expect(await runCycle(d, st)).toBe('notified'); expect(d.sent).toHaveLength(6);
});
test('0건이면 매물 없음 메시지를 1번만', async () => {
  const d = makeDeps({ search: async () => [] });
  expect(await runCycle(d, st)).toBe('notified'); expect(await runCycle(d, st)).toBe('unchanged');
  expect(d.sent).toEqual([formatNoResultsMessage(d.spec)]);
});
test('한도 이하면 검색하지 않고 하루 1번만 알린다', async () => {
  const searchSpy = vi.fn(async () => []);
  const d = makeDeps({ getRemaining: async () => 10, search: searchSpy });
  expect(await runCycle(d, st)).toBe('limit'); expect(await runCycle(d, st)).toBe('limit');
  expect(searchSpy).not.toHaveBeenCalled(); expect(d.sent).toHaveLength(1); expect(d.state.limitAlertDate).toBe(localDateString(d.now()));
});
test('세션 만료: 새로고침으로 복구되면 알림 없이 recovered', async () => {
  const d = makeDeps({ search: async () => { throw new SessionExpiredError('x'); }, recoverSession: async () => true });
  expect(await runCycle(d, st)).toBe('recovered'); expect(d.sent).toHaveLength(0);
});
test('세션 만료: 복구 실패면 로그인 알림 후 onLoginRequired를 기다린다', async () => {
  const login = vi.fn(async () => {});
  const d = makeDeps({ search: async () => { throw new SessionExpiredError('x'); }, recoverSession: async () => false, onLoginRequired: login });
  expect(await runCycle(d, st)).toBe('relogin'); expect(login).toHaveBeenCalledTimes(1);
  expect(d.sent).toEqual([formatLoginRequiredMessage()]);
});
test('일반 오류는 3번째에만 알린다', async () => {
  const d = makeDeps({ search: async () => { throw new Error('boom'); } });
  for (let i = 0; i < 4; i++) expect(await runCycle(d, st)).toBe('failed');
  expect(d.sent).toEqual([formatFailureMessage(3, 'Error: boom')]); expect(st.consecutiveFailures).toBe(4);
});
test('notify가 던져도 runCycle은 던지지 않는다', async () => {
  const d = makeDeps({ search: async () => [L('a', 10)], notify: async () => { throw new Error('kakao down'); } });
  await expect(runCycle(d, st)).resolves.toBe('notified'); expect(d.state.lastFingerprint).toBe('a:10');
});
test('startLoop는 즉시 1회 실행하고 간격마다 반복한다', async () => { vi.useFakeTimers(); /* 0ms에 1회, advance(interval)마다 +1 */ });
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/loop.test.ts` Expected: FAIL
- [ ] **Step 3: `src/watch/loop.ts` 구현** — `startLoop`는 `running` 플래그로 겹침을 막고 `setInterval`을 쓴다. 모든 `notify` 호출은 try/catch로 감싸 `log`에 남긴다.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/loop.test.ts` Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add src/watch/loop.ts tests/loop.test.ts
git commit -m "feat: 변경 감지 기반 감시 루프"
```

---

### Task 10: 실행 명령 조립 (`npm start`, `search:once`)

**Files:**
- Create: `src/cli/start.ts`, `src/cli/search-once.ts`, `src/cli/_bootstrap.ts`

**Interfaces:**
- Consumes: 모든 이전 태스크.
- Produces:
  ```ts
  // _bootstrap.ts
  export interface Session { config: AppConfig; browser: AuctionBrowser; selection: Selection; body: SearchRequestBody }
  export async function openSession(opts: { requireLogin: boolean }): Promise<Session>;
  // .env 읽기 → loadConfig → launchAuctionBrowser(data/browser-profile) → waitForSession(20000) 실패 시 안내 출력 후 waitForSession(0) → minimize → resolveSelection → buildSearchRequest
  ```

- [ ] **Step 1: `_bootstrap.ts` 작성** — 설정 오류(`ConfigError`)는 메시지만 출력하고 종료 코드 2. 선택 실패(`ApiError`)도 메시지 출력 후 종료 코드 2.

- [ ] **Step 2: `search-once.ts` 작성** — `openSession` → `getDailyLimit` 출력 → `searchListings` → `topN` → 각 `formatListingMessage`를 구분선과 함께 출력, 마지막에 `textLength`도 출력. 카카오 전송 없음. 끝나면 브라우저 닫기.

- [ ] **Step 3: `start.ts` 작성**

`openSession` → `createKakaoNotifier` → `loadState(data/state.json)` → `WatchDeps` 조립:
- `search`: `searchListings(browser, body)`
- `getRemaining`: `(await getDailyLimit(browser)).remaining`
- `recoverSession`: `browser.waitForSession(15000)`
- `onLoginRequired`: `browser.restore()` → `waitForSession(0)` → `browser.minimize()`
- `log`: `console.log(`[${new Date().toLocaleTimeString('ko-KR')}] ${msg}`)`
시작 시 `notify(formatStartMessage(spec, remaining))`. `startLoop(deps, intervalMinutes * 60_000)`. `SIGINT`/`SIGTERM`에서 `stop()` → `browser.close()` → 종료. 잡히지 않은 오류(`uncaughtException`, `unhandledRejection`)는 `notify(formatStopMessage(String(err)))`를 시도한 뒤 종료 코드 1.

- [ ] **Step 4: 타입 검사와 전체 테스트** — Run: `npm run typecheck && npx vitest run` Expected: PASS

- [ ] **Step 5: (사용자) Windows에서 수동 확인**

1. `npm run kakao:auth` → 브라우저에서 동의 → `data/kakao-token.json` 생성.
2. `npm run kakao:test` → 카카오톡 "나와의 채팅"에 테스트 메시지 도착.
3. `npm run search:once` → 상위 3건이 터미널에 보이고 각 길이 ≤ 200.
4. `npm start` → 시작 메시지 도착, 첫 검색 결과 3건 도착, 15분 뒤 같은 결과면 추가 메시지 없음. Ctrl+C로 종료.

Expected: 위 4가지 모두 확인. 실패하면 해당 태스크로 돌아간다.

- [ ] **Step 6: Commit**

```bash
git add src/cli/_bootstrap.ts src/cli/start.ts src/cli/search-once.ts
git commit -m "feat: npm start / search:once 실행 명령"
```

---

### Task 11: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: README 작성 (Windows 기준, 한국어)**

순서대로: (1) Node.js LTS 설치, (2) `npm install`, (3) `npx playwright install chromium`, (4) 카카오 개발자 앱 만들기: 앱 생성 → [앱 설정 > 앱 키]에서 REST API 키 복사 → [제품 설정 > 카카오 로그인] 활성화, 리다이렉트 URI `http://localhost:3131/oauth` 등록 → [동의항목]에서 `talk_message`(카카오톡 메시지 전송) 설정 → [앱 설정 > 플랫폼 > Web]에 `https://auction.maplestory.nexon.com` 사이트 도메인 등록 (메시지 링크용), (5) `.env.example`을 `.env`로 복사해 수정, 옵션 라벨은 옥션 화면 그대로, (6) `npm run kakao:auth`, (7) `npm run search:once`로 조건 확인, (8) `npm start`. 그리고 "하루 운영 방법" 절: 출근 후 켜기, 로그인 창이 뜨면 OTP 로그인, 퇴근 시 Ctrl+C, 살 때는 끄고 들어가기. "문제 해결" 절: 로그인 필요 알림, 한도 알림, 카카오 토큰 만료(2개월) 시 `kakao:auth` 재실행.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: Windows 설치와 운영 안내"
```
