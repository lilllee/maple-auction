import { describe, expect, test } from 'vitest';
import { isApiRequest, mergeCapturedHeaders, pickApiHeaders } from '../src/nexon/browser.js';

describe('browser pure functions', () => {
  test('isApiRequest', () => {
    expect(isApiRequest('https://api.mskr.nexon.com/v1/x')).toBe(true);
    expect(isApiRequest('https://auction.maplestory.nexon.com/buy')).toBe(false);
  });

  test('pickApiHeaders는 3개 헤더만 남긴다', () => {
    expect(
      pickApiHeaders({
        'x-device-id': 'd',
        'x-platform': 'PC_WEB',
        'x-client-version': '1.0.2',
        cookie: 'c',
        accept: '*/*',
      }),
    ).toEqual({ 'x-device-id': 'd', 'x-platform': 'PC_WEB', 'x-client-version': '1.0.2' });
  });

  test('mergeCapturedHeaders는 부분 헤더가 와도 기존 키를 유지한다', () => {
    const prev = { 'x-device-id': 'd', 'x-platform': 'PC_WEB', 'x-client-version': '1.0.2' };
    expect(mergeCapturedHeaders(prev, { 'x-platform': 'MOBILE' })).toEqual({
      'x-device-id': 'd',
      'x-platform': 'MOBILE',
      'x-client-version': '1.0.2',
    });
    expect(mergeCapturedHeaders(prev, {})).toEqual(prev);
  });
});
