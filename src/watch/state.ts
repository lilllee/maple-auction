import fs from 'node:fs';
import path from 'node:path';

export interface WatchState {
  lastFingerprint: string | null;
  lastResultCount: number | null;
  limitAlertDate: string | null;
}

export const EMPTY_STATE: WatchState = Object.freeze({
  lastFingerprint: null,
  lastResultCount: null,
  limitAlertDate: null,
});

export function loadState(file: string): WatchState {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...EMPTY_STATE };
    const o = raw as Record<string, unknown>;
    return {
      lastFingerprint: typeof o.lastFingerprint === 'string' ? o.lastFingerprint : null,
      lastResultCount: typeof o.lastResultCount === 'number' ? o.lastResultCount : null,
      limitAlertDate: typeof o.limitAlertDate === 'string' ? o.limitAlertDate : null,
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function saveState(file: string, s: WatchState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2), 'utf8');
}
