import path from 'node:path';
import { loadConfig, readEnvFile } from '../config.js';
import { createKakaoNotifier } from '../kakao/send.js';

async function main(): Promise<void> {
  const cfg = loadConfig(readEnvFile(path.resolve('.env')));
  const tokenFile = path.join(cfg.dataDir, 'kakao-token.json');
  await createKakaoNotifier(cfg.kakao, tokenFile).send('[옥션] 테스트 메시지입니다.');
  console.log('전송 완료');
}

main().catch((err: unknown) => {
  console.error('오류: ' + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
});
