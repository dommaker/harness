/**
 * 铁律层 flag 检查旁测（架构评审候选4，ADR-0009 同模式）
 *
 * 三个 flag 铁律均为 contextEvidenceFlag 构造，真实 bug 面 = 读错上下文字段
 * 与三态语义（undefined→skip / false→fail / true→pass）。直接喂不同字段组合
 * 钉死映射，不再经 engine facade（旧测在 skip-semantics/checker.test 间接打）。
 */

import { describe, it, expect } from '@jest/globals';
import {
  noCompletionWithoutVerification,
  incrementalProgress,
  noImplementationWithoutRequirement,
} from '../iron-flags';
import { buildCheckEnv } from '../types';
import type { ConstraintContext } from '../../../../types/constraint';

const evaluate = (
  check: { evaluate: (env: any) => unknown },
  ctx: Partial<ConstraintContext>
) => check.evaluate(buildCheckEnv({ ...ctx, operation: 'code_implementation' }, 'none'));

describe('iron flags — 三态与字段映射', () => {
  it('no_completion_without_verification → 读 hasVerificationEvidence', async () => {
    expect(await evaluate(noCompletionWithoutVerification, {})).toBe('skip');
    expect(await evaluate(noCompletionWithoutVerification, { hasVerificationEvidence: false })).toBe(false);
    expect(await evaluate(noCompletionWithoutVerification, { hasVerificationEvidence: true })).toBe(true);
    // 相邻字段不串台：hasTest 不能顶替
    expect(await evaluate(noCompletionWithoutVerification, { hasTest: true })).toBe('skip');
  });

  it('incremental_progress → 读 hasSingleTask', async () => {
    expect(await evaluate(incrementalProgress, {})).toBe('skip');
    expect(await evaluate(incrementalProgress, { hasSingleTask: false })).toBe(false);
    expect(await evaluate(incrementalProgress, { hasSingleTask: true })).toBe(true);
  });

  it('no_implementation_without_requirement → 读 hasRequirement', async () => {
    expect(await evaluate(noImplementationWithoutRequirement, {})).toBe('skip');
    expect(await evaluate(noImplementationWithoutRequirement, { hasRequirement: false })).toBe(false);
    expect(await evaluate(noImplementationWithoutRequirement, { hasRequirement: true })).toBe(true);
  });

  it('三 flag 各自独立判定（组合上下文互不影响）', async () => {
    const ctx: Partial<ConstraintContext> = { hasVerificationEvidence: true, hasSingleTask: false };
    expect(await evaluate(noCompletionWithoutVerification, ctx)).toBe(true);
    expect(await evaluate(incrementalProgress, ctx)).toBe(false);
    expect(await evaluate(noImplementationWithoutRequirement, ctx)).toBe('skip');
  });
});
