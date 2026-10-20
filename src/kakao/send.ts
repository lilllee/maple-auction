import { BUY_PAGE_URL, MAX_TEXT_LENGTH, textLength, truncateWithEllipsis } from '../format.js';
import { type KakaoCfg, type KakaoTokens, loadTokens, needsRefresh, refreshTokens, saveTokens } from './auth.js';

export const SEND_URL = 'https://kapi.kakao.com/v2/api/talk/memo/default/send';

export function buildTextTemplate(text: string, linkUrl: string): { object_type: 'text'; text: string; link: { web_url: string; mobile_web_url: string } } {
  return { object_type: 'text', text, link: { web_url: linkUrl, mobile_web_url: linkUrl } };
}

export interface Notifier { send(text: string): Promise<void> }

export function createKakaoNotifier(cfg: KakaoCfg, tokenFile: string, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Notifier {
  const post = (accessToken: string, text: string) =>
    fetchImpl(SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: 'template_object=' + encodeURIComponent(JSON.stringify(buildTextTemplate(text, BUY_PAGE_URL))),
    });

  return {
    async send(rawText: string): Promise<void> {
      const text = textLength(rawText) > MAX_TEXT_LENGTH ? truncateWithEllipsis(rawText, MAX_TEXT_LENGTH) : rawText;
      let tokens: KakaoTokens | null = loadTokens(tokenFile);
      if (!tokens) throw new Error('카카오 토큰이 없습니다. npm run kakao:auth 를 먼저 실행하세요.');

      const refresh = async (t: KakaoTokens): Promise<KakaoTokens> => {
        const next = await refreshTokens(t, cfg, fetchImpl, now());
        saveTokens(tokenFile, next);
        return next;
      };

      if (needsRefresh(tokens, now())) tokens = await refresh(tokens);

      let res = await post(tokens.accessToken, text);
      if (res.status === 401) {
        tokens = await refresh(tokens);
        res = await post(tokens.accessToken, text);
      }

      const body = await res.text();
      let ok = res.ok;
      if (ok) {
        try { ok = (JSON.parse(body) as { result_code?: unknown }).result_code === 0; } catch { ok = false; }
      }
      if (!ok) throw new Error(`카카오 메시지 전송 실패 (HTTP ${res.status}): ${body}`);
    },
  };
}
