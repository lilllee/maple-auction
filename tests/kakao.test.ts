import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  AUTHORIZE_URL, TOKEN_URL, buildAuthorizeUrl, loadTokens, needsRefresh, saveTokens, tokensFromResponse,
} from '../src/kakao/auth.js';
import { SEND_URL, buildTextTemplate, createKakaoNotifier } from '../src/kakao/send.js';
import { BUY_PAGE_URL } from '../src/format.js';

const cfg = { restApiKey: 'KEY', clientSecret: null, redirectPort: 3131 };
const now = 1_000_000;
let file: string;
beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kakao-')), 'sub', 'kakao-token.json');
});
const fresh = () => ({ accessToken: 'old', refreshToken: 'r', accessExpiresAt: now + 3600_000, refreshExpiresAt: now + 10_000_000 });

test('authorize url', () => {
  const u = new URL(buildAuthorizeUrl('KEY', 3131));
  expect(u.origin + u.pathname).toBe(AUTHORIZE_URL);
  expect(u.searchParams.get('client_id')).toBe('KEY');
  expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:3131/oauth');
  expect(u.searchParams.get('scope')).toBe('talk_message'); expect(u.searchParams.get('response_type')).toBe('code');
});
test('tokensFromResponse와 needsRefresh', () => {
  const t = tokensFromResponse({ access_token: 'a', refresh_token: 'r', expires_in: 21600, refresh_token_expires_in: 5184000 }, 1_000_000);
  expect(t).toEqual({ accessToken: 'a', refreshToken: 'r', accessExpiresAt: 1_000_000 + 21600 * 1000, refreshExpiresAt: 1_000_000 + 5184000 * 1000 });
  expect(needsRefresh(t, 1_000_000)).toBe(false);
  expect(needsRefresh(t, t.accessExpiresAt - 5 * 60 * 1000)).toBe(true);
  const r = tokensFromResponse({ access_token: 'b', expires_in: 1 }, 5, t);
  expect(r.refreshToken).toBe('r');
  expect(r.refreshExpiresAt).toBe(t.refreshExpiresAt);
});
test('tokensFromResponse는 필수 필드가 없으면 던진다', () => {
  expect(() => tokensFromResponse({ expires_in: 1 }, 0)).toThrow();
  expect(() => tokensFromResponse({ access_token: 'a' }, 0)).toThrow();
});
test('loadTokens/saveTokens', () => {
  expect(loadTokens(file)).toBeNull();
  saveTokens(file, fresh());
  expect(loadTokens(file)).toEqual(fresh());
  fs.writeFileSync(file, '{broken');
  expect(loadTokens(file)).toBeNull();
  fs.writeFileSync(file, '{"accessToken":1}');
  expect(loadTokens(file)).toBeNull();
});
test('텍스트 템플릿', () => {
  expect(buildTextTemplate('안녕', 'https://x')).toEqual({ object_type: 'text', text: '안녕', link: { web_url: 'https://x', mobile_web_url: 'https://x' } });
});
test('토큰이 없으면 안내 오류', async () => {
  await expect(createKakaoNotifier(cfg, file, (async () => new Response('{}')) as any, () => now).send('hi'))
    .rejects.toThrow('카카오 토큰이 없습니다. npm run kakao:auth 를 먼저 실행하세요.');
});
test('send 요청 형식', async () => {
  const seen: { url: string; init: any }[] = [];
  const fetchImpl = async (url: string, init: any) => { seen.push({ url, init }); return new Response('{"result_code":0}', { status: 200 }); };
  saveTokens(file, fresh());
  await createKakaoNotifier(cfg, file, fetchImpl as any, () => now).send('안녕 & 100%');
  expect(seen).toHaveLength(1);
  expect(seen[0].url).toBe(SEND_URL);
  expect(seen[0].init.method).toBe('POST');
  expect(seen[0].init.headers.Authorization).toBe('Bearer old');
  expect(seen[0].init.headers['Content-Type']).toBe('application/x-www-form-urlencoded;charset=utf-8');
  expect(seen[0].init.body).toBe('template_object=' + encodeURIComponent(JSON.stringify(buildTextTemplate('안녕 & 100%', BUY_PAGE_URL))));
});
test('만료 임박이면 먼저 갱신하고 저장한다', async () => {
  const calls: { url: string; init: any }[] = [];
  const fetchImpl = async (url: string, init: any) => {
    calls.push({ url, init });
    if (url === TOKEN_URL) return new Response(JSON.stringify({ access_token: 'new', expires_in: 21600 }), { status: 200 });
    return new Response('{"result_code":0}', { status: 200 });
  };
  saveTokens(file, { ...fresh(), accessExpiresAt: now + 60_000 });
  await createKakaoNotifier({ ...cfg, clientSecret: 'SEC' }, file, fetchImpl as any, () => now).send('hi');
  expect(calls.map(c => c.url)).toEqual([TOKEN_URL, SEND_URL]);
  const body = new URLSearchParams(calls[0].init.body);
  expect(Object.fromEntries(body)).toEqual({ grant_type: 'refresh_token', client_id: 'KEY', refresh_token: 'r', client_secret: 'SEC' });
  expect(calls[1].init.headers.Authorization).toBe('Bearer new');
  expect(loadTokens(file)).toMatchObject({ accessToken: 'new', refreshToken: 'r' });
});
test('send는 401이면 한 번 갱신 후 재시도한다', async () => {
  const calls: string[] = [];
  const fetchImpl = async (url: string, init: any) => {
    calls.push(url);
    if (url === SEND_URL && calls.filter(c => c === SEND_URL).length === 1) return new Response('{"msg":"expired"}', { status: 401 });
    if (url === TOKEN_URL) return new Response(JSON.stringify({ access_token: 'new', expires_in: 21600 }), { status: 200 });
    return new Response('{"result_code":0}', { status: 200 });
  };
  saveTokens(file, fresh());
  await createKakaoNotifier(cfg, file, fetchImpl as any, () => now).send('hi');
  expect(calls).toEqual([SEND_URL, TOKEN_URL, SEND_URL]);
  expect(loadTokens(file)!.accessToken).toBe('new');
});
test('재시도도 401이면 더 갱신하지 않고 던진다', async () => {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    if (url === TOKEN_URL) return new Response(JSON.stringify({ access_token: 'new', expires_in: 21600 }), { status: 200 });
    return new Response('{"msg":"still-401"}', { status: 401 });
  };
  saveTokens(file, fresh());
  await expect(createKakaoNotifier(cfg, file, fetchImpl as any, () => now).send('hi')).rejects.toThrow(/still-401/);
  expect(calls).toEqual([SEND_URL, TOKEN_URL, SEND_URL]);
});
test('result_code가 0이 아니면 본문을 담아 던진다', async () => {
  const fetchImpl = async () => new Response('{"result_code":-1,"why":"nope"}', { status: 200 });
  saveTokens(file, fresh());
  await expect(createKakaoNotifier(cfg, file, fetchImpl as any, () => now).send('hi')).rejects.toThrow(/nope/);
});
test('2xx가 아니면 본문을 담아 던진다', async () => {
  const fetchImpl = async () => new Response('server-boom', { status: 500 });
  saveTokens(file, fresh());
  await expect(createKakaoNotifier(cfg, file, fetchImpl as any, () => now).send('hi')).rejects.toThrow(/server-boom/);
});
test('갱신도 실패하면 Error를 던진다', async () => {
  const fetchImpl = async (url: string) => url === TOKEN_URL ? new Response('{"error":"invalid_grant"}', { status: 400 }) : new Response('{}', { status: 401 });
  saveTokens(file, fresh());
  await expect(createKakaoNotifier(cfg, file, fetchImpl as any, () => now).send('hi')).rejects.toThrow(/invalid_grant/);
});
