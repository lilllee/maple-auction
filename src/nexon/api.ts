export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export function toApiError(status: number, data: unknown): SessionExpiredError | ApiError {
  if (status === 401 || status === 426) {
    return new SessionExpiredError(`세션이 만료되었습니다 (HTTP ${status})`);
  }
  let body: string;
  try {
    body = JSON.stringify(data) ?? String(data);
  } catch {
    body = String(data);
  }
  return new ApiError(`옥션 API 오류 (HTTP ${status}): ${body.slice(0, 200)}`, status);
}
