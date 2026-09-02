/**
 * no_test_simplification 检查器旁测（架构评审候选4，ADR-0009 同模式）
 *
 * 测试面 = ConstraintCheck.evaluate(env)：判定只吃 stagedDiff 文本，
 * 证据经 providers 注入（旧 facade 测用真实非 git 目录触发 IO 失败，
 * 旁测直接让 provider 抛错表达同一语义）。自 checker-extra.test.ts 迁入。
 */

import { describe, it, expect } from '@jest/globals';
import { noTestSimplification } from '../no-test-simplification';
import { buildCheckEnv } from '../types';
import type { ConstraintContext } from '../../../../types/constraint';

function evaluate(diff: string | (() => Promise<string>)) {
  const context: ConstraintContext = { operation: 'test_creation', projectPath: '/nonexistent' };
  const stagedDiff = typeof diff === 'function' ? diff : async () => diff;
  return noTestSimplification.evaluate(
    buildCheckEnv(context, {
      stagedDiff,
      stagedDiffNames: async () => '',
      srcScan: () => [],
    })
  );
}

describe('no_test_simplification', () => {
  it('删除 test/it/describe → fail', async () => {
    expect(await evaluate('--- a/x.test.ts\n+++ b/x.test.ts\n@@\n-  test("gone", () => {});\n')).toBe(false);
    expect(await evaluate('-  it("gone", () => {});')).toBe(false);
    expect(await evaluate('-describe("suite", () => {});')).toBe(false);
  });

  it('删除 expect → fail', async () => {
    expect(await evaluate('-    expect(x).toBe(y);')).toBe(false);
  });

  it('删除注释掉的 test → fail', async () => {
    expect(await evaluate('-  // test pending case')).toBe(false);
  });

  it('仅新增/上下文行 → pass', async () => {
    expect(
      await evaluate('--- a/x.test.ts\n+++ b/x.test.ts\n@@\n+  test("added", () => {});\n   expect(1).toBe(1);\n')
    ).toBe(true);
  });

  it('空 diff → pass', async () => {
    expect(await evaluate('')).toBe(true);
  });

  it('git diff 失败 → 默认通过（fail-open，自 facade 测迁入）', async () => {
    expect(
      await evaluate(async () => {
        throw new Error('not a git repository');
      })
    ).toBe(true);
  });
});
