import path from 'node:path';
import { loadConfig, readEnvFile } from '../config.js';
import { runAuthFlow } from '../kakao/auth.js';

async function main(): Promise<void> {
  const cfg = loadConfig(readEnvFile(path.resolve('.env')));
  const tokenFile = path.join(cfg.dataDir, 'kakao-token.json');
  await runAuthFlow(cfg.kakao, tokenFile);
  console.log(`토큰 저장: ${tokenFile}`);
}

main().catch((err: unknown) => {
  console.error('오류: ' + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
});
