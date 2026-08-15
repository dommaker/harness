/**
 * checker-as-guard 接线点测试（G1 / studio #129 随动）
 */

import { createCheckerGate } from '../checker-gate';
import { contextFlag, contextEvidenceFlag } from '../../core/constraints/checkers/types';

describe('createCheckerGate', () => {
  const ctx = { projectId: 'p', projectPath: '/tmp/project' };

  it('checker 通过（true）→ abstain', async () => {
    const gate = createCheckerGate(contextFlag('flag-pass', () => true), 7);
    expect(gate.id).toBe('flag-pass');
    expect(gate.order).toBe(7);

    const decision = await gate.evaluate(ctx);
    expect(decision.status).toBe('abstain');
    expect(decision.result.gate).toBe('flag-pass');
    expect(decision.result.passed).toBe(true);
    expect(decision.result.message).toContain('通过');
  });

  it('checker 违规（false）→ deny', async () => {
    const gate = createCheckerGate(contextFlag('flag-fail', () => false));
    const decision = await gate.evaluate(ctx);
    expect(decision.status).toBe('deny');
    expect(decision.result.passed).toBe(false);
    expect(decision.result.message).toContain('判定违规');
  });

  it('证据未接线（skip）→ abstain（不阻断）', async () => {
    const gate = createCheckerGate(
      contextEvidenceFlag('flag-skip', () => undefined)
    );
    const decision = await gate.evaluate(ctx);
    expect(decision.status).toBe('abstain');
    expect(decision.result.message).toContain('跳过');
  });

  it('决策浅冻结（单调语义契约）', async () => {
    const gate = createCheckerGate(contextFlag('flag-freeze', () => true));
    const decision = await gate.evaluate(ctx);
    expect(Object.isFrozen(decision)).toBe(true);
  });
});
