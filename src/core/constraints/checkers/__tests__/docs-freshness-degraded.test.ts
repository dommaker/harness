/**
 * docs_freshness fail-open 发声测试（harness#182）
 *
 * FreshnessRunner 异常此前被整体 try/catch 静默吞掉（连 warn 都没有）——
 * error 级约束顶着「检查器失效」报「合规」。对齐 capability_sync 姿势：
 * console.warn + pass + evidence（降级提示进结果面与 trace），本套件钉死该路径。
 * 单独成文件：FreshnessRunner 需模块级 mock，与 docs-freshness.test.ts 的真 runner 用例隔离。
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('../../doc-freshness/runner', () => ({
  FreshnessRunner: jest.fn(function () {
    return {
      runAll: () => {
        throw new Error('runner boom');
      },
    };
  }),
}));

import { docsFreshness } from '../docs-freshness';
import { buildCheckEnv, normalizeCheckOutcome } from '../types';
import { createProjectFixture } from '../../../../test-setup/project-fixture';
import type { ConstraintContext } from '../../../../types/constraint';

describe('docs_freshness — FreshnessRunner 异常 → fail-open 但发声', () => {
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runner 抛错 → warn + pass + 降级证据行（不再静默吞错）', async () => {
    // CHANGELOG 使存在性探测命中（进入 Step 2）；版本一致，差异只来自 runner 异常
    const dir = createProjectFixture({
      name: 'docs-fresh-runner-boom',
      files: {
        'CHANGELOG.md': '## [1.0.0] - 2026-01-01\n\n- init\n',
        'package.json': JSON.stringify({ name: 'x', version: '1.0.0' }),
      },
    });
    const context: ConstraintContext = { operation: 'file_modification', projectPath: dir };
    const env = buildCheckEnv(context, {
      stagedDiff: async () => '',
      stagedDiffNames: async () => '',
      srcScan: () => [],
    });

    const outcome = normalizeCheckOutcome(await docsFreshness.evaluate(env));

    expect(warnSpy).toHaveBeenCalled();
    expect(outcome.skipped).toBe(false);
    expect(outcome.satisfied).toBe(true); // fail-open 保留
    expect(outcome.evidence.join('\n')).toContain('fail-open');
    expect(outcome.evidence.join('\n')).toContain('runner boom');
  });

  it('Step 1 取数异常不吞掉 Step 2：两条降级提示都进 evidence，warn 各发一次', async () => {
    const dir = createProjectFixture({
      name: 'docs-fresh-step1-boom',
      files: {
        'CAPABILITIES.md': '# Capabilities\n\n| 模块 | 文件 | 说明 |\n|------|------|------|\n| m | src/m.ts | m |\n',
        'src/m.ts': 'export const x = 1;\n',
      },
    });
    const context: ConstraintContext = { operation: 'file_modification', projectPath: dir };
    const env = buildCheckEnv(context, {
      stagedDiff: async () => '',
      stagedDiffNames: async () => '',
      srcScan: () => {
        throw new Error('scan boom');
      },
    });

    const outcome = normalizeCheckOutcome(await docsFreshness.evaluate(env));

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(outcome.satisfied).toBe(true);
    const text = outcome.evidence.join('\n');
    expect(text).toContain('文件表幽灵检查异常');
    expect(text).toContain('scan boom');
    expect(text).toContain('runner boom'); // Step 2 照跑（其异常独立发声）
  });
});
