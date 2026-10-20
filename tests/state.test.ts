import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { EMPTY_STATE, loadState, saveState } from '../src/watch/state.js';

const dir = path.join(os.tmpdir(), `st-${Date.now()}`);
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('state 왕복과 깨진 파일', () => {
  const f = path.join(dir, 'state.json');
  expect(loadState(f)).toEqual(EMPTY_STATE);
  saveState(f, { lastFingerprint: 'x', lastResultCount: 1, limitAlertDate: '2026-10-19' });
  expect(loadState(f).lastFingerprint).toBe('x');
  fs.writeFileSync(f, '{broken'); expect(loadState(f)).toEqual(EMPTY_STATE);
});

test('객체가 아닌 JSON이면 빈 상태, 빠진 키는 null', () => {
  const f = path.join(dir, 'other.json');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, '[1,2]'); expect(loadState(f)).toEqual(EMPTY_STATE);
  fs.writeFileSync(f, '{"lastResultCount": 3}');
  expect(loadState(f)).toEqual({ lastFingerprint: null, lastResultCount: 3, limitAlertDate: null });
});
