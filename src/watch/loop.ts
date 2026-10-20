import type { SearchSpec } from '../config.js';
import {
  formatFailureMessage, formatLimitMessage, formatListingMessage,
  formatLoginRequiredMessage, formatNoResultsMessage,
} from '../format.js';
import { SessionExpiredError } from '../nexon/api.js';
import type { Listing } from '../nexon/listing.js';
import { fingerprint, topN } from './fingerprint.js';
import type { WatchState } from './state.js';

export interface WatchDeps {
  search(): Promise<Listing[]>;
  getRemaining(): Promise<number>;
  notify(text: string): Promise<void>;
  recoverSession(): Promise<boolean>;
  onLoginRequired(): Promise<void>;
  now(): Date;
  state: WatchState; saveState(s: WatchState): void;
  spec: SearchSpec; topN: number; minRemainingSearches: number;
  log(msg: string): void;
}
export type CycleResult = 'notified' | 'unchanged' | 'limit' | 'recovered' | 'relogin' | 'failed';
export interface LoopStatus { consecutiveFailures: number }
export const FAILURE_ALERT_AT = 3;

export function localDateString(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

async function safeNotify(deps: WatchDeps, text: string): Promise<void> {
  try {
    await deps.notify(text);
  } catch (err) {
    deps.log('알림 전송 실패: ' + (err instanceof Error ? err.message : String(err)));
  }
}

function update(deps: WatchDeps, patch: Partial<WatchState>): void {
  Object.assign(deps.state, patch);
  deps.saveState(deps.state);
}

export async function runCycle(deps: WatchDeps, status: LoopStatus): Promise<CycleResult> {
  try {
    const remaining = await deps.getRemaining();
    if (remaining <= deps.minRemainingSearches) {
      const today = localDateString(deps.now());
      if (deps.state.limitAlertDate !== today) {
        await safeNotify(deps, formatLimitMessage(remaining));
        update(deps, { limitAlertDate: today });
      }
      return 'limit';
    }

    const top = topN(await deps.search(), deps.topN);
    const fp = fingerprint(top);
    status.consecutiveFailures = 0;
    if (fp === deps.state.lastFingerprint) return 'unchanged';

    if (top.length === 0) {
      await safeNotify(deps, formatNoResultsMessage(deps.spec));
    } else {
      for (const [i, l] of top.entries()) {
        await safeNotify(deps, formatListingMessage(l, i + 1, top.length));
      }
    }
    update(deps, { lastFingerprint: fp, lastResultCount: top.length });
    return 'notified';
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      if (await deps.recoverSession()) return 'recovered';
      await safeNotify(deps, formatLoginRequiredMessage());
      await deps.onLoginRequired();
      return 'relogin';
    }
    status.consecutiveFailures += 1;
    if (status.consecutiveFailures === FAILURE_ALERT_AT) {
      await safeNotify(deps, formatFailureMessage(FAILURE_ALERT_AT, String(err)));
    }
    return 'failed';
  }
}

export function startLoop(deps: WatchDeps, intervalMs: number): { stop(): void } {
  const status: LoopStatus = { consecutiveFailures: 0 };
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await runCycle(deps, status);
      deps.log(`[${deps.now().toISOString()}] 주기 결과: ${result}`);
    } catch (err) {
      deps.log(`[${deps.now().toISOString()}] 주기 오류: ${String(err)}`);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, intervalMs);
  return { stop: () => clearInterval(timer) };
}
