import { describe, expect, test } from 'vitest';
import { isApiRequest, pickApiHeaders } from '../src/nexon/browser.js';

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
});
