/**
 * 铁律层 flag 检查旁测（架构评审候选4，ADR-0009 同模式）
 *
 * 唯一存活的 flag 铁律为 contextEvidenceFlag 构造，真实 bug 面 = 读错上下文字段
 * 与三态语义（undefined→skip / false→fail / true→pass）。直接喂不同字段组合
 * 钉死映射，不再经 engine facade（旧测在 skip-semantics/checker.test 间接打）。
 *
 * harness#174 删除 incremental_progress / no_implementation_without_requirement，
 * 对应用例一并移除。
 */

import { describe, it, expect } from '@jest/globals';
import { noCompletionWithoutVerification } from '../iron-flags';
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
});
