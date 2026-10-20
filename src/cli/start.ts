import path from 'node:path';
import { createWatchDeps, dailySearchWarning, errorMessage, exitCodeFor, openSession } from './_bootstrap.js';
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

  const { remaining, limit } = await getDailyLimit(browser).catch(async (err: unknown) => {
    await browser.close().catch(() => undefined);
    throw err;
  });
  const warning = dailySearchWarning(config.intervalMinutes, limit, config.minRemainingSearches);
  if (warning) console.log(warning);
  try {
    await notifier.send(formatStartMessage(config.search, remaining));
  } catch (err) {
    await browser.close().catch(() => undefined);
    console.error('오류: ' + errorMessage(err));
    process.exitCode = 2;
    return;
  }

  const loop = startLoop(deps, config.intervalMinutes * 60_000);
  console.log(`감시 시작: ${config.intervalMinutes}분마다 검색, Ctrl+C로 종료`);

  let exiting = false;
  const shutdown = (): void => {
    if (exiting) return;
    exiting = true;
    loop.stop();
    void browser.close().catch(() => undefined).then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const crash = (err: unknown): void => {
    console.error('오류: ' + errorMessage(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    if (exiting) return;
    exiting = true;
    loop.stop();
    void (async () => {
      const timeout = new Promise<void>((r) => setTimeout(r, 10_000).unref());
      await Promise.race([
        notifier.send(formatStopMessage(String(err))).catch(() => undefined),
        timeout,
      ]);
      await Promise.race([browser.close().catch(() => undefined), timeout]);
      process.exit(1);
    })();
  };
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);

  browser.page.on('close', () => {
    if (exiting) return;
    exiting = true;
    console.error('브라우저 창이 닫혔습니다. 프로그램을 종료합니다.');
    loop.stop();
    process.exit(1);
  });
}

main().catch((err: unknown) => {
  console.error('오류: ' + errorMessage(err));
  process.exitCode = exitCodeFor(err);
});
