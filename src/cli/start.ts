import path from 'node:path';
import { createWatchDeps, errorMessage, exitCodeFor, openSession } from './_bootstrap.js';
import { formatStartMessage, formatStopMessage } from '../format.js';
import { createKakaoNotifier } from '../kakao/send.js';
import { getDailyLimit } from '../nexon/api.js';
import { startLoop } from '../watch/loop.js';
import { loadState } from '../watch/state.js';

async function main(): Promise<void> {
  const session = await openSession({ requireLogin: true });
  const { config, browser } = session;
  const notifier = createKakaoNotifier(config.kakao, path.join(config.dataDir, 'kakao-token.json'));
  const stateFile = path.join(config.dataDir, 'state.json');
  const log = (msg: string): void => console.log(`[${new Date().toLocaleTimeString('ko-KR')}] ${msg}`);
  const deps = createWatchDeps({ session, notifier, state: loadState(stateFile), stateFile, log });

  try {
    const { remaining } = await getDailyLimit(browser);
    await notifier.send(formatStartMessage(config.search, remaining));
  } catch (err) {
    await browser.close().catch(() => undefined);
    console.error('오류: ' + errorMessage(err));
    process.exitCode = 2;
    return;
  }

  const loop = startLoop(deps, config.intervalMinutes * 60_000);
  console.log(`감시 시작: ${config.intervalMinutes}분마다 검색, Ctrl+C로 종료`);

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    loop.stop();
    void browser.close().catch(() => undefined).then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  let crashing = false;
  const crash = (err: unknown): void => {
    if (crashing) return;
    crashing = true;
    loop.stop();
    void (async () => {
      try { await notifier.send(formatStopMessage(String(err))); } catch { /* 무시 */ }
      try { await browser.close(); } catch { /* 무시 */ }
      process.exit(1);
    })();
  };
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);
}

main().catch((err: unknown) => {
  console.error('오류: ' + errorMessage(err));
  process.exitCode = exitCodeFor(err);
});
