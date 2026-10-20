import { describe, expect, test } from 'vitest';
import { ApiError, SessionExpiredError, toApiError } from '../src/nexon/api.js';

describe('toApiError', () => {
  test('401/426은 세션 만료, 그 외는 ApiError', () => {
    expect(toApiError(401, { code: 5 })).toBeInstanceOf(SessionExpiredError);
    expect(toApiError(426, null)).toBeInstanceOf(SessionExpiredError);
    expect(toApiError(500, null)).toBeInstanceOf(ApiError);
    expect((toApiError(500, null) as ApiError).status).toBe(500);
  });
});
