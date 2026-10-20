import { exec } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export interface KakaoTokens { accessToken: string; refreshToken: string; accessExpiresAt: number; refreshExpiresAt: number } // epoch ms
export type KakaoCfg = { restApiKey: string; clientSecret: string | null; redirectPort: number };

export const AUTHORIZE_URL = 'https://kauth.kakao.com/oauth/authorize';
export const TOKEN_URL = 'https://kauth.kakao.com/oauth/token';

const REFRESH_MARGIN_MS = 10 * 60 * 1000;

export function redirectUri(port: number): string {
  return `http://localhost:${port}/oauth`;
}

export function buildAuthorizeUrl(restApiKey: string, port: number): string {
  const q = new URLSearchParams({
    client_id: restApiKey,
    redirect_uri: redirectUri(port),
    response_type: 'code',
    scope: 'talk_message',
  });
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

export function tokensFromResponse(json: unknown, now: number, prev?: KakaoTokens): KakaoTokens {
  const j = (json ?? {}) as Record<string, unknown>;
  if (typeof j.access_token !== 'string' || !j.access_token) throw new Error('카카오 토큰 응답에 access_token이 없습니다.');
  if (typeof j.expires_in !== 'number') throw new Error('카카오 토큰 응답에 expires_in이 없습니다.');
  const refreshToken = typeof j.refresh_token === 'string' && j.refresh_token ? j.refresh_token : prev?.refreshToken;
  if (!refreshToken) throw new Error('카카오 토큰 응답에 refresh_token이 없습니다.');
  const refreshExpiresAt = typeof j.refresh_token_expires_in === 'number' && j.refresh_token_expires_in
    ? now + j.refresh_token_expires_in * 1000
    : prev?.refreshExpiresAt ?? 0;
  return { accessToken: j.access_token, refreshToken, accessExpiresAt: now + j.expires_in * 1000, refreshExpiresAt };
}

export function needsRefresh(t: KakaoTokens, now: number): boolean {
  return t.accessExpiresAt - now < REFRESH_MARGIN_MS;
}

async function requestToken(params: Record<string, string>, cfg: KakaoCfg, fetchImpl: typeof fetch): Promise<unknown> {
  const body = new URLSearchParams(params);
  if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret);
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`카카오 토큰 요청 실패 (HTTP ${res.status}): ${text}`);
  try { return JSON.parse(text); } catch { throw new Error(`카카오 토큰 응답을 해석할 수 없습니다: ${text}`); }
}

export async function exchangeCode(code: string, cfg: KakaoCfg, fetchImpl: typeof fetch = fetch, now: number = Date.now()): Promise<KakaoTokens> {
  const json = await requestToken({
    grant_type: 'authorization_code',
    client_id: cfg.restApiKey,
    redirect_uri: redirectUri(cfg.redirectPort),
    code,
  }, cfg, fetchImpl);
  return tokensFromResponse(json, now);
}

export async function refreshTokens(t: KakaoTokens, cfg: KakaoCfg, fetchImpl: typeof fetch = fetch, now: number = Date.now()): Promise<KakaoTokens> {
  const json = await requestToken({
    grant_type: 'refresh_token',
    client_id: cfg.restApiKey,
    refresh_token: t.refreshToken,
  }, cfg, fetchImpl);
  return tokensFromResponse(json, now, t);
}

export function loadTokens(file: string): KakaoTokens | null {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (
      typeof j.accessToken === 'string' && typeof j.refreshToken === 'string' &&
      typeof j.accessExpiresAt === 'number' && typeof j.refreshExpiresAt === 'number'
    ) {
      return { accessToken: j.accessToken, refreshToken: j.refreshToken, accessExpiresAt: j.accessExpiresAt, refreshExpiresAt: j.refreshExpiresAt };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveTokens(file: string, t: KakaoTokens): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(t, null, 2), 'utf8');
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  try { exec(cmd, () => { /* 실패해도 URL을 이미 출력했으므로 무시 */ }); } catch { /* 무시 */ }
}

export function runAuthFlow(cfg: KakaoCfg, tokenFile: string): Promise<KakaoTokens> {
  return new Promise<KakaoTokens>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${cfg.redirectPort}`);
      if (req.method !== 'GET' || url.pathname !== '/oauth') {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const finish = (status: number, message: string, done: () => void) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(message, () => {
          server.close(done);
          server.closeAllConnections?.();
        });
      };
      if (error) {
        const desc = url.searchParams.get('error_description');
        const msg = `카카오 인증 실패: ${error}${desc ? ` (${desc})` : ''}`;
        finish(400, msg.replace(/[<>&]/g, ''), () => reject(new Error(msg)));
        return;
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end('code가 없습니다.');
        return;
      }
      exchangeCode(code, cfg).then(
        (tokens) => {
          saveTokens(tokenFile, tokens);
          finish(200, '인증 완료. 창을 닫아도 됩니다.', () => resolve(tokens));
        },
        (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          finish(500, '토큰 발급에 실패했습니다. 터미널을 확인하세요.', () => reject(new Error(msg)));
        },
      );
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      reject(new Error(err.code === 'EADDRINUSE'
        ? `포트 ${cfg.redirectPort}이(가) 이미 사용 중입니다. KAKAO_REDIRECT_PORT를 바꾸세요.`
        : `인증 서버 오류: ${err.message}`));
    });
    server.listen(cfg.redirectPort, '127.0.0.1', () => {
      const authUrl = buildAuthorizeUrl(cfg.restApiKey, cfg.redirectPort);
      console.log('브라우저에서 아래 주소로 카카오 로그인을 진행하세요. (자동으로 열리지 않으면 직접 복사해 여세요)');
      console.log(authUrl);
      openBrowser(authUrl);
    });
  });
}
