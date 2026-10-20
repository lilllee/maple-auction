import { errorMessage, exitCodeFor, openSession } from './_bootstrap.js';
import { formatListingMessage, textLength } from '../format.js';
import { getDailyLimit, searchListings } from '../nexon/api.js';
import { topN } from '../watch/fingerprint.js';

async function main(): Promise<void> {
  const { config, browser, body } = await openSession({ requireLogin: true });
  try {
    const { remaining, limit } = await getDailyLimit(browser);
    console.log(`오늘 남은 검색: ${remaining}/${limit}`);
    const listings = await searchListings(browser, body);
    const top = topN(listings, config.topN);
    if (top.length === 0) {
      console.log('조건에 맞는 매물이 없습니다.');
    }
    top.forEach((l, i) => {
      const text = formatListingMessage(l, i + 1, top.length);
      console.log(text);
      console.log(`---- (${textLength(text)}자)`);
    });
    console.log('(검색 1회 사용)');
  } finally {
    await browser.close().catch(() => undefined);
  }
}

main().catch((err: unknown) => {
  console.error('오류: ' + errorMessage(err));
  process.exitCode = exitCodeFor(err);
});
