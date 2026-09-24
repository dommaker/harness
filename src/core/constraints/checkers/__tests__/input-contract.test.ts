/**
 * 检查器输入契约测试（harness#182）
 *
 * 「检查器失效 ≠ 对象合规」的接缝锁定：
 * - findMissingInputs：checker 声明的 needs 与环境供给比对（缺证据 / flag 未接线）
 * - 编排层降级：git 取证失败 → 带原因的 skipped，不进入 evaluate（不再对空 diff 假 pass）
 * - skipReason 落 ConstraintResult 与 ExecutionTrace（可统计的失效信号）
 */

import { describe, it, expect } from '@jest/globals';
import { ConstraintChecker } from '../../checker';
import { createGitEvidence } from '../../git-evidence';
import {
  buildCheckEnv,
  findMissingInputs,
  normalizeCheckOutcome,
  type ConstraintCheck,
} from '../types';
import { noTestSimplification } from '../no-test-simplification';
import type { Constraint, ConstraintContext } from '../../../../types/constraint';
import type { MergedConstraintsConfig } from '../../../../types/project-config';
import type { ExecutionTrace } from '../../../../types/trace';

const NO_TEST_SIMPLIFICATION: Constraint = {
  id: 'no_test_simplification',
  kind: 'check',
  severity: 'error',
  rule: 'DO NOT DELETE TESTS',
  message: '禁止简化测试绕过困难',
  trigger: 'commit',
  enforcement: 'restore-tests',
};

const CONTEXT: ConstraintContext = { operation: 'commit', projectPath: '/nonexistent' };

function envOf(context: ConstraintContext, available: Record<string, boolean>) {
  return buildCheckEnv(context, {
    stagedDiff: async () => '',
    stagedDiffNames: async () => '',
    srcScan: () => [],
    available: (input) => available[input] ?? true,
  });
}

describe('findMissingInputs — needs 与环境供给比对', () => {
  it('未声明 needs → 无缺项', () => {
    expect(findMissingInputs({ id: 'x', evaluate: () => true }, envOf(CONTEXT, {}))).toEqual([]);
  });

  it('evidenceAvailable 报不可得 → 缺项自描述', () => {
    const missing = findMissingInputs(noTestSimplification, envOf(CONTEXT, { stagedDiff: false }));
    expect(missing).toEqual(['staged diff 不可得（git 取证失败或未接线）']);
  });

  it('contextFlags 为 undefined → 缺项点名标志', () => {
    const check: ConstraintCheck = {
      id: 'flag-check',
      needs: { contextFlags: ['hasVerificationEvidence'] },
      evaluate: () => true,
    };
    expect(findMissingInputs(check, envOf(CONTEXT, {}))).toEqual([
      '证据标志 hasVerificationEvidence 未接线',
    ]);
    expect(
      findMissingInputs(check, envOf({ ...CONTEXT, hasVerificationEvidence: false }, {}))
    ).toEqual([]);
  });

  it('手写 env 未提供 evidenceAvailable → 按全部可得（旧形状兼容）', () => {
    const env = buildCheckEnv(CONTEXT, {
      stagedDiff: async () => '',
      stagedDiffNames: async () => '',
      srcScan: () => [],
    });
    expect(findMissingInputs(noTestSimplification, env)).toEqual([]);
  });
});

describe('normalizeCheckOutcome — CheckSkip 归一', () => {
  it('{ skip, reason } → skipped + skipReason，evidence 恒空（未评估不留证据行）', () => {
    expect(normalizeCheckOutcome({ skip: true, reason: '输入不可得' })).toEqual({
      satisfied: true,
      skipped: true,
      evidence: [],
      skipReason: '输入不可得',
    });
  });
});

/** 只含 no_test_simplification 的生效集：一次 run 一条 trace */
function onlyNoTestSimplification(): MergedConstraintsConfig {
  return { constraints: { no_test_simplification: NO_TEST_SIMPLIFICATION }, disabled: [] };
}

describe('编排层输入契约降级（git 取证失败 → 带原因的 skipped）', () => {
  const throwingRunner = () => {
    throw new Error('not a git repository');
  };

  it('git 失败 → skipped + skipReason，不阻断（fail-open 但不假 pass）', async () => {
    const checker = new ConstraintChecker();
    const git = createGitEvidence('/nonexistent', throwingRunner);

    const result = await checker.check(NO_TEST_SIMPLIFICATION, CONTEXT, git);

    expect(result.skipped).toBe(true);
    expect(result.satisfied).toBe(true);
    expect(result.skipReason).toContain('staged diff 不可得');
    expect(result.message).toContain('staged diff 不可得');
  });

  it('git 失败 → trace 记 result:skip 且携带 skipReason（失效可统计）', async () => {
    const traces: ExecutionTrace[] = [];
    const checker = new ConstraintChecker({ record: (t) => traces.push(t) });
    const git = createGitEvidence('/nonexistent', throwingRunner);

    const run = await checker.checkConstraints(CONTEXT, onlyNoTestSimplification(), git);

    expect(run.passed).toBe(true);
    expect(run.errors[0].skipped).toBe(true);
    const trace = traces.find(t => t.constraintId === 'no_test_simplification')!;
    expect(trace.result).toBe('skip');
    expect(trace.skipReason).toContain('staged diff 不可得');
  });

  it('git 正常 → 进入评估（对照：契约齐备不降级）', async () => {
    const checker = new ConstraintChecker();
    const git = createGitEvidence('/nonexistent', () => '');

    const result = await checker.check(NO_TEST_SIMPLIFICATION, CONTEXT, git);

    expect(result.skipped).toBeUndefined();
    expect(result.satisfied).toBe(true);
  });
});
