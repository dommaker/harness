/**
 * no_hardcoded_credentials checker 测试（ADR-0001）
 *
 * 注意：测试夹具中的假凭证一律用字符串拼接构造，
 * 避免本文件自身被凭证扫描（含 harness 自身 staged diff）命中。
 */

import { describe, it, expect } from '@jest/globals';
import {
  noHardcodedCredentials,
  containsHardcodedCredential,
} from '../core/constraints/checkers/no-hardcoded-credentials';
import type { CheckEnv } from '../core/constraints/checkers';

function makeEnv(stagedDiff: string): CheckEnv {
  return {
    context: { operation: 'commit', projectPath: '/nonexistent' },
    projectPath: '/nonexistent',
    stagedDiff: async () => stagedDiff,
    stagedDiffNames: async () => '',
    srcScan: () => [],
  };
}

const AWS_KEY = 'AKIA' + '1234567890ABCDEF';
const PEM_HEADER = '-----BEGIN ' + 'RSA PRIVATE KEY-----';
const PASSWORD_ASSIGN = 'const dbPass' + 'word = "sup3r-s3cret-value";';

describe('containsHardcodedCredential', () => {
  it('命中 PEM 私钥头', () => {
    expect(containsHardcodedCredential(PEM_HEADER + '\nMIIE...')).toBe(true);
  });

  it('命中 AWS Access Key', () => {
    expect(containsHardcodedCredential(`const key = "${AWS_KEY}";`)).toBe(true);
  });

  it('命中硬编码 password 赋值', () => {
    expect(containsHardcodedCredential(PASSWORD_ASSIGN)).toBe(true);
  });

  it('命中硬编码 api_key 赋值', () => {
    expect(containsHardcodedCredential('api' + '_key: "abcdef123456789"')).toBe(true);
  });

  it('豁免环境变量引用', () => {
    expect(
      containsHardcodedCredential('const pass' + 'word = process.env.DB_PASSWORD;')
    ).toBe(false);
  });

  it('豁免占位符值', () => {
    expect(
      containsHardcodedCredential('const pass' + 'word = "your-password-here";')
    ).toBe(false);
  });

  it('普通代码不误报', () => {
    expect(
      containsHardcodedCredential('export function add(a: number, b: number) { return a + b; }')
    ).toBe(false);
  });
});

describe('noHardcodedCredentials checker', () => {
  it('staged diff 新增行命中凭证 → fail', async () => {
    const diff = [
      'diff --git a/src/config.ts b/src/config.ts',
      '--- a/src/config.ts',
      '+++ b/src/config.ts',
      '@@ -0,0 +1 @@',
      '+' + PASSWORD_ASSIGN,
    ].join('\n');
    expect(await noHardcodedCredentials.evaluate(makeEnv(diff))).toBe(false);
  });

  it('staged diff 仅删除行含凭证 → pass（删除凭证是好事）', async () => {
    const diff = ['--- a/src/config.ts', '+++ /dev/null', '-' + PASSWORD_ASSIGN].join('\n');
    expect(await noHardcodedCredentials.evaluate(makeEnv(diff))).toBe(true);
  });

  it('staged diff 无凭证 → pass', async () => {
    const diff = '+++ b/src/a.ts\n+export const x = 1;\n';
    expect(await noHardcodedCredentials.evaluate(makeEnv(diff))).toBe(true);
  });

  it('staged diff 为空且无可读变更文件 → pass', async () => {
    expect(await noHardcodedCredentials.evaluate(makeEnv(''))).toBe(true);
  });
});
