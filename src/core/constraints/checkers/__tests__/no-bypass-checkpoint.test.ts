/**
 * no_bypass_checkpoint 检查器旁测（架构评审候选4，ADR-0009 同模式）
 *
 * 测试面 = ConstraintCheck.evaluate(env)：判定只读 env.context.changedFiles
 * 的文件内容，无需 git staging（旧 facade 测用真实 git add 属多余 fixture）。
 * 自 checker-extra.test.ts 迁入并补齐 BYPASS_PATTERNS 全表用例。
 * 违规样例字符串一律拼接构造，避免本文件被该检查器自身命中。
 * 项目根由 src/test-setup/project-fixture 声明式构造（回收仍走 mkdtemp-cleanup）。
 */

import { describe, it, expect } from '@jest/globals';
import * as os from 'os';
import * as path from 'path';
import { noBypassCheckpoint } from '../no-bypass-checkpoint';
import { buildCheckEnv } from '../types';
import { createProjectFixture } from '../../../../test-setup/project-fixture';
import type { ConstraintContext } from '../../../../types/constraint';

/** 与 BYPASS_PATTERNS 对齐的违规样例（拼接构造，源文本不含完整模式串） */
const VIOLATIONS: Array<[string, string]> = [
  ['jest/vitest skip 调用', 'test.' + 'skip("skipped", () => {});'],
  ['bypass 标志赋值', 'config.byp' + 'ass = true;'],
  ['skip 选项', '{ run: { skip' + ': true } }'],
  ['显式 bypass 注释', '# bypa' + 'ss checkpoint for perf'],
  ['行注释 skip', 'code(); // ' + 'skip this for now'],
];

function writeTemp(name: string, content: string): string {
  const root = createProjectFixture({
    name: `no-bypass-${name}`,
    files: { 'subject.ts': content },
  });
  return path.join(root, 'subject.ts');
}

function evaluate(changedFiles: string[]) {
  const context: ConstraintContext = {
    operation: 'code_implementation',
    projectPath: process.cwd(),
    changedFiles,
  };
  return noBypassCheckpoint.evaluate(buildCheckEnv(context, 'none'));
}

describe('no_bypass_checkpoint', () => {
  it('无变更文件 → pass（默认放行）', async () => {
    expect(await evaluate([])).toBe(true);
  });

  for (const [label, content] of VIOLATIONS) {
    it(`命中 bypass 模式（${label}）→ fail`, async () => {
      expect(await evaluate([writeTemp('hit', content)])).toBe(false);
    });
  }

  it('干净测试文件 → pass（旧 facade 对照用例）', async () => {
    expect(
      await evaluate([writeTemp('clean', 'test("clean", () => { expect(1).toBe(1); });')])
    ).toBe(true);
  });

  it('变更文件已删除（不在 fs）→ 跳过该文件继续', async () => {
    expect(await evaluate([path.join(os.tmpdir(), 'no-bypass-gone', 'ghost.ts')])).toBe(true);
  });

  it('文件不可读（目录当文件）→ 忽略不炸', async () => {
    const dir = createProjectFixture({ name: 'no-bypass-dir' });
    expect(await evaluate([dir])).toBe(true);
  });

  it('多文件任一命中即 fail', async () => {
    const clean = writeTemp('multi-clean', 'export const x = 1;');
    const dirty = writeTemp('multi-dirty', VIOLATIONS[0][1]);
    expect(await evaluate([clean, dirty])).toBe(false);
  });
});
