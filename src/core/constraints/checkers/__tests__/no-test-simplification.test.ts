/**
 * no_test_simplification 检查器旁测（架构评审候选4，ADR-0009 同模式）
 *
 * 测试面 = ConstraintCheck.evaluate(env)：判定只吃 stagedDiff 文本，
 * 证据经 providers 注入（旧 facade 测用真实非 git 目录触发 IO 失败，
 * 旁测直接让 provider 抛错表达同一语义）。自 checker-extra.test.ts 迁入。
 *
 * harness#185 启发式修正：判定限定测试文件（.test./.spec./__tests__），
 * 配对新增豁免（净删除才判），新增 .skip/.only/xit/xdescribe 判违规。
 */

import { describe, it, expect } from '@jest/globals';
import { noTestSimplification } from '../no-test-simplification';
import { buildCheckEnv, type CheckDetail } from '../types';
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

/** 构造单文件 unified diff */
function diffFor(path: string, body: string): string {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,5 +1,5 @@\n${body}`;
}

/** fail 结果必须是带证据的 CheckDetail，且证据指到文件 */
async function expectFailWithEvidence(diff: string, fileHint: string) {
  const outcome = await evaluate(diff);
  expect(typeof outcome).toBe('object');
  const detail = outcome as CheckDetail;
  expect(detail.pass).toBe(false);
  expect(detail.evidence?.some(e => e.includes(fileHint))).toBe(true);
}

describe('no_test_simplification', () => {
  describe('净删除判定（限测试文件）', () => {
    it('净删除 test/it/describe → fail', async () => {
      await expectFailWithEvidence(
        diffFor('src/x.test.ts', '-  test("gone", () => {});\n'),
        'src/x.test.ts'
      );
      await expectFailWithEvidence(diffFor('src/x.test.ts', '-  it("gone", () => {});\n'), 'src/x.test.ts');
      await expectFailWithEvidence(
        diffFor('src/x.test.ts', '-describe("suite", () => {});\n'),
        'src/x.test.ts'
      );
    });

    it('净删除 expect → fail', async () => {
      await expectFailWithEvidence(diffFor('src/x.test.ts', '-    expect(x).toBe(y);\n'), 'src/x.test.ts');
    });

    it('删除注释掉的 test → fail', async () => {
      await expectFailWithEvidence(diffFor('src/x.test.ts', '-  // test pending case\n'), 'src/x.test.ts');
    });

    it('删多增少（净删除）→ fail', async () => {
      const body =
        '-  it("a", () => {});\n-  it("b", () => {});\n-  it("c", () => {});\n+  it("renamed", () => {});\n';
      await expectFailWithEvidence(diffFor('src/x.test.ts', body), 'src/x.test.ts');
    });

    it('.spec. 文件净删除 → fail', async () => {
      await expectFailWithEvidence(diffFor('src/x.spec.ts', '-  it("gone", () => {});\n'), 'src/x.spec.ts');
    });

    it('__tests__ 路径净删除 → fail', async () => {
      await expectFailWithEvidence(
        diffFor('src/__tests__/x.ts', '-  it("gone", () => {});\n'),
        'src/__tests__/x.ts'
      );
    });

    it('整文件删除（+++ /dev/null）的测试文件 → fail', async () => {
      const diff =
        'diff --git a/src/x.test.ts b/src/x.test.ts\ndeleted file mode 100644\n--- a/src/x.test.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-  it("a", () => {});\n-  expect(1).toBe(1);\n';
      await expectFailWithEvidence(diff, 'src/x.test.ts');
    });
  });

  describe('配对新增豁免（重命名/改写不误报）', () => {
    it('重命名测试（-it 配 +it）→ pass', async () => {
      const body = '-  it("旧名", () => {});\n+  it("新名", () => {});\n';
      expect(await evaluate(diffFor('src/x.test.ts', body))).toBe(true);
    });

    it('修改断言（-expect 配 +expect）→ pass', async () => {
      const body = '-    expect(x).toBe(oldValue);\n+    expect(x).toBe(newValue);\n';
      expect(await evaluate(diffFor('src/x.test.ts', body))).toBe(true);
    });

    it('重构 helper：测试块删增等量 → pass', async () => {
      const body =
        '-describe("old suite", () => {});\n-it("a", () => {});\n+describe("new suite", () => {});\n+it("a", () => {});\n';
      expect(await evaluate(diffFor('src/x.test.ts', body))).toBe(true);
    });
  });

  describe('跳过/独占形态检测', () => {
    it('新增 .skip( → fail', async () => {
      await expectFailWithEvidence(diffFor('src/x.test.ts', '+  it.skip("flaky", () => {});\n'), 'src/x.test.ts');
      await expectFailWithEvidence(
        diffFor('src/x.test.ts', '+  describe.skip("suite", () => {});\n'),
        'src/x.test.ts'
      );
      await expectFailWithEvidence(
        diffFor('src/x.test.ts', '+  test.skip("flaky", () => {});\n'),
        'src/x.test.ts'
      );
    });

    it('新增 .only( → fail', async () => {
      await expectFailWithEvidence(diffFor('src/x.test.ts', '+  test.only("focus", () => {});\n'), 'src/x.test.ts');
      await expectFailWithEvidence(diffFor('src/x.test.ts', '+  it.only("focus", () => {});\n'), 'src/x.test.ts');
    });

    it('新增 xit(/xdescribe( → fail', async () => {
      await expectFailWithEvidence(diffFor('src/x.test.ts', '+  xit("gone", () => {});\n'), 'src/x.test.ts');
      await expectFailWithEvidence(diffFor('src/x.test.ts', '+  xdescribe("s", () => {});\n'), 'src/x.test.ts');
    });

    it('把 it( 改成 it.skip(（删旧增新）仍 → fail', async () => {
      const body = '-  it("flaky", () => {});\n+  it.skip("flaky", () => {});\n';
      await expectFailWithEvidence(diffFor('src/x.test.ts', body), 'src/x.test.ts');
    });

    it('非测试文件新增 .skip( → pass', async () => {
      expect(await evaluate(diffFor('src/list.ts', '+  node.skip();\n'))).toBe(true);
    });

    it('删除 .skip(（恢复测试）→ pass', async () => {
      const body = '-  it.skip("flaky", () => {});\n+  it("flaky", () => {});\n';
      expect(await evaluate(diffFor('src/x.test.ts', body))).toBe(true);
    });
  });

  describe('范围限定（非测试文件不判）', () => {
    it('非测试文件删除 test( 字样 → pass', async () => {
      expect(await evaluate(diffFor('src/runner.ts', '-  test(benchmark);\n'))).toBe(true);
    });

    it('混合 diff：非测试文件删除不判，测试文件净删除照判', async () => {
      const diff =
        diffFor('src/runner.ts', '-  test(benchmark);\n') +
        diffFor('src/x.test.ts', '-  it("gone", () => {});\n');
      await expectFailWithEvidence(diff, 'src/x.test.ts');
    });

    it('仅新增/上下文行 → pass', async () => {
      const body = '+  test("added", () => {});\n   expect(1).toBe(1);\n';
      expect(await evaluate(diffFor('src/x.test.ts', body))).toBe(true);
    });

    it('空 diff → pass', async () => {
      expect(await evaluate('')).toBe(true);
    });

    it('无文件归属的裸删除行 → fail（fail-closed：无法证明不在测试文件）', async () => {
      await expectFailWithEvidence('-  it("gone", () => {});', '无文件归属');
    });
  });

  it('声明 stagedDiff 输入契约（harness#182）：git 取证失败由编排层降级，不假 pass', () => {
    expect(noTestSimplification.needs).toEqual({ evidence: ['stagedDiff'] });
  });

  it('git diff 失败 → 带原因的 skip（fail-open 但不假 pass，harness#182）', async () => {
    const outcome = await evaluate(async () => {
      throw new Error('not a git repository');
    });
    expect(outcome).toEqual({ skip: true, reason: 'staged diff 取证失败：not a git repository' });
  });
});
