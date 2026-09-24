/**
 * no_hardcoded_credentials 检查器旁测（ADR-0001；harness#184 收窄正则版 + fail 证据行）
 *
 * 注意：测试夹具中的假凭证一律用字符串拼接构造，
 * 避免本文件自身被凭证扫描（含 harness 自身 staged diff）命中。
 * 测试面 = evaluate(env)（架构评审候选4，自 src/__tests__/ 就近迁入）。
 */

import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, afterAll } from '@jest/globals';
import {
  noHardcodedCredentials,
  containsHardcodedCredential,
} from '../no-hardcoded-credentials';
import type { CheckEnv } from '../types';
import { createRunEnv } from '../../run-env';

function makeEnv(stagedDiff: string): CheckEnv {
  return {
    ...createRunEnv('/nonexistent'),
    context: { operation: 'commit', projectPath: '/nonexistent' },
    stagedDiff: async () => stagedDiff,
    stagedDiffNames: async () => '',
    srcScan: () => [],
  };
}

const AWS_KEY = 'AKIA' + '1234567890ABCDEF';
const PEM_HEADER = '-----BEGIN ' + 'RSA PRIVATE KEY-----';
const PASSWORD_ASSIGN = 'const dbPass' + 'word = "sup3r-s3cret-value";';
const JWT =
  'eyJ' + 'hbGciOiJIUzI1NiJ9.' + 'eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0.' + 'dozjgNryP4J3jVmNHl0w5N_XgL0n';

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

  it('命中 .env 裸值（无引号赋值）', () => {
    expect(containsHardcodedCredential('DB_TO' + 'KEN=abc123def456ghi')).toBe(true);
  });

  it('命中无引号 YAML 值', () => {
    expect(containsHardcodedCredential('pass' + 'word: secret123')).toBe(true);
  });

  it('命中 URL 内嵌凭证', () => {
    expect(containsHardcodedCredential('const url = "postgres:/' + '/user:pw12345@db.host/app";')).toBe(true);
  });

  it('命中 JSON 带引号键', () => {
    expect(containsHardcodedCredential('"pass' + 'word": "realvalue123"')).toBe(true);
  });

  it('命中非清单变量名 credential/privateKey/signingKey', () => {
    expect(containsHardcodedCredential('cred' + 'ential = "realvalue123";')).toBe(true);
    expect(containsHardcodedCredential('private' + 'Key = "realvalue123";')).toBe(true);
    expect(containsHardcodedCredential('signing' + '_key: realvalue123')).toBe(true);
  });

  it('命中 JWT', () => {
    expect(containsHardcodedCredential(`const tok = "${JWT}";`)).toBe(true);
  });

  it('行内出现 test 不再整行豁免真实值', () => {
    expect(
      containsHardcodedCredential('const pass' + 'word = "realvalue123"; // test fixture')
    ).toBe(true);
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

  it('豁免 TS 类型注解（值是类型名而非字面量）', () => {
    expect(containsHardcodedCredential('api' + 'Key: string|undefined;')).toBe(false);
  });

  it('豁免 URL 中的变量插值占位', () => {
    expect(
      containsHardcodedCredential('postgres://user:' + '${' + 'DB_PASS}@host/db')
    ).toBe(false);
  });

  it('普通代码不误报', () => {
    expect(
      containsHardcodedCredential('export function add(a: number, b: number) { return a + b; }')
    ).toBe(false);
  });
});

describe('noHardcodedCredentials checker', () => {
  it('staged diff 新增行命中凭证 → fail，证据带文件+行号', async () => {
    const diff = [
      'diff --git a/src/config.ts b/src/config.ts',
      '--- a/src/config.ts',
      '+++ b/src/config.ts',
      '@@ -3,3 +3,4 @@',
      ' line3',
      '+line4',
      '+' + PASSWORD_ASSIGN,
    ].join('\n');
    const outcome = await noHardcodedCredentials.evaluate(makeEnv(diff));
    expect(outcome).not.toBe(true);
    expect(typeof outcome).toBe('object');
    const detail = outcome as { pass: boolean; evidence?: string[] };
    expect(detail.pass).toBe(false);
    expect(detail.evidence?.some(l => l.includes('src/config.ts:5'))).toBe(true);
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

  it('diff 路径按文件过滤：.env.example 的真实值形态不误报', async () => {
    const diff = [
      'diff --git a/.env.example b/.env.example',
      '--- a/.env.example',
      '+++ b/.env.example',
      '@@ -0,0 +1 @@',
      '+DB_TO' + 'KEN=abc123def456ghi',
    ].join('\n');
    expect(await noHardcodedCredentials.evaluate(makeEnv(diff))).toBe(true);
  });

  it('diff 路径按文件过滤：文档中的 PEM 头样例不误报', async () => {
    const diff = [
      'diff --git a/docs/keys.md b/docs/keys.md',
      '--- a/docs/keys.md',
      '+++ b/docs/keys.md',
      '@@ -0,0 +1 @@',
      '+' + PEM_HEADER,
    ].join('\n');
    expect(await noHardcodedCredentials.evaluate(makeEnv(diff))).toBe(true);
  });

  describe('diff 不可用时退化为变更文件内容扫描', () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-cred-test-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    function contentEnv(files: string[]): CheckEnv {
      return {
        ...createRunEnv(dir),
        context: { operation: 'commit', projectPath: dir, changedFiles: files },
        stagedDiff: async () => '',
        stagedDiffNames: async () => '',
        srcScan: () => [],
      };
    }

    it('内容路径命中 → fail，证据带文件+行号', async () => {
      writeFileSync(join(dir, '.env'), '# comment\nDB_TO' + 'KEN=abc123def456ghi\n');
      const outcome = await noHardcodedCredentials.evaluate(contentEnv(['.env']));
      expect(typeof outcome).toBe('object');
      const detail = outcome as { pass: boolean; evidence?: string[] };
      expect(detail.pass).toBe(false);
      expect(detail.evidence?.some(l => l.includes('.env:2'))).toBe(true);
    });

    it('内容路径同样豁免模板文件', async () => {
      writeFileSync(join(dir, '.env.example'), 'DB_TO' + 'KEN=abc123def456ghi\n');
      expect(await noHardcodedCredentials.evaluate(contentEnv(['.env.example']))).toBe(true);
    });
  });
});
