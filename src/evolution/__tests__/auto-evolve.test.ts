/**
 * autoEvolve 函数测试
 */

import type { ExecutionTrace, TraceAnomaly } from '../../types/trace';
import type { Diagnosis, ConstraintProposal, ProposalReviewResult } from '../../types/monitoring-types';
import type { ExecutionResult } from '../../constraints/lifecycle-runner';

jest.mock('../../monitoring/constraint-doctor', () => {
  const mockDiagnose = jest.fn();
  const mockSetData = jest.fn();
  const actual = jest.requireActual('../../monitoring/constraint-doctor');

  return {
    ...actual,
    ConstraintDoctor: jest.fn().mockImplementation(() => ({
      diagnose: mockDiagnose,
      setData: mockSetData,
    })),
    createDoctor: jest.fn(),
    get mockDiagnose() { return mockDiagnose; },
    get mockSetData() { return mockSetData; },
  };
});

jest.mock('../../monitoring/constraint-evolver', () => {
  const mockPropose = jest.fn();
  const mockReview = jest.fn();
  const actual = jest.requireActual('../../monitoring/constraint-evolver');

  return {
    ...actual,
    ConstraintEvolver: jest.fn().mockImplementation(() => ({
      propose: mockPropose,
      review: mockReview,
    })),
    createEvolver: jest.fn(),
    get mockPropose() { return mockPropose; },
    get mockReview() { return mockReview; },
  };
});

jest.mock('../../constraints/lifecycle-runner', () => {
  const mockExecute = jest.fn();
  const actual = jest.requireActual('../../constraints/lifecycle-runner');

  return {
    ...actual,
    ConstraintLifecycleRunner: jest.fn().mockImplementation(() => ({
      execute: mockExecute,
    })),
    get mockExecute() { return mockExecute; },
  };
});

function makeProposal(overrides: Record<string, unknown> = {}): ConstraintProposal {
  return {
    id: 'test-proposal',
    proposedAt: Date.now(),
    diagnosisId: 'test-diag',
    constraintId: 'test-constraint',
    type: 'add_exception',
    content: { proposed: 'test', description: 'Test' },
    reasoning: 'Test',
    expectedOutcome: 'ok',
    risk: { level: 'low', description: 'Low risk' },
    implementation: { files: [], linesChanged: 1, testsRequired: true },
    status: 'proposed',
    ...overrides,
  } as unknown as ConstraintProposal;
}

function makeDiagnosis(overrides: Record<string, unknown> = {}): Diagnosis {
  return {
    anomalyId: 'test-anomaly',
    constraintId: 'test-constraint',
    diagnosedAt: Date.now(),
    needsChange: true,
    rootCause: { primary: 'Test', evidence: [] },
    impact: { severity: 'low', scope: 'single_project', userImpact: 'Test' },
    recommendations: [{ type: 'add_exception', content: 'test', expectedOutcome: 'ok', implementationCost: 'low' }],
    urgency: 'low',
    ...overrides,
  } as unknown as Diagnosis;
}

describe('autoEvolve', () => {
  const mockDiagnose = (jest.requireMock('../../monitoring/constraint-doctor') as any).mockDiagnose;
  const mockPropose = (jest.requireMock('../../monitoring/constraint-evolver') as any).mockPropose;
  const mockReview = (jest.requireMock('../../monitoring/constraint-evolver') as any).mockReview;
  const mockExecute = (jest.requireMock('../../constraints/lifecycle-runner') as any).mockExecute;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('无异常时应该返回空结果', async () => {
    const { autoEvolve } = await import('../auto-evolve');

    const result = await autoEvolve([], []);

    expect(result.diagnoses).toEqual([]);
    expect(result.proposals).toEqual([]);
    expect(result.autoApproved).toBe(0);
    expect(result.needsReview).toBe(0);
    expect(result.executions).toEqual([]);
    expect(mockDiagnose).not.toHaveBeenCalled();
  });

  it('异常不需要变更时应该跳过', async () => {
    const anomalies: TraceAnomaly[] = [{
      type: 'high_bypass_rate',
      constraintId: 'test-constraint',
      level: 'guideline',
      message: 'Test anomaly',
      data: { currentRate: 0.5, threshold: 0.3 },
      detectedAt: Date.now(),
    }];

    const traces: ExecutionTrace[] = [];

    mockDiagnose.mockResolvedValue(makeDiagnosis({ needsChange: false }));

    const { autoEvolve } = await import('../auto-evolve');
    const result = await autoEvolve(traces, anomalies);

    expect(result.diagnoses).toHaveLength(1);
    expect(result.proposals).toEqual([]);
    expect(mockPropose).not.toHaveBeenCalled();
  });

  it('提案为 null 时应该跳过', async () => {
    const anomalies: TraceAnomaly[] = [{
      type: 'high_bypass_rate',
      constraintId: 'test-constraint',
      level: 'guideline',
      message: 'Test',
      data: { currentRate: 0.5, threshold: 0.3 },
      detectedAt: Date.now(),
    }];

    mockDiagnose.mockResolvedValue(makeDiagnosis());
    mockPropose.mockResolvedValue(null);

    const { autoEvolve } = await import('../auto-evolve');
    const result = await autoEvolve([], anomalies);

    expect(result.proposals).toEqual([]);
  });

  it('低风险提案应自动批准并执行', async () => {
    const anomalies: TraceAnomaly[] = [{
      type: 'high_bypass_rate',
      constraintId: 'test-constraint',
      level: 'guideline',
      message: 'Test',
      data: { currentRate: 0.5, threshold: 0.3 },
      detectedAt: Date.now(),
    }];

    mockDiagnose.mockResolvedValue(makeDiagnosis());
    mockPropose.mockResolvedValue(makeProposal({ id: 'proposal-1' }));
    mockReview.mockReturnValue({ accepted: true, comment: 'Auto-approved' } as ProposalReviewResult);
    mockExecute.mockReturnValue({
      proposalId: 'proposal-1',
      constraintId: 'test-constraint',
      action: 'add_exception',
      success: true,
      details: 'Added exception',
    } as ExecutionResult);

    const { autoEvolve } = await import('../auto-evolve');
    const result = await autoEvolve([], anomalies, { autoApproveLowRisk: true });

    expect(result.autoApproved).toBe(1);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].status).toBe('implemented');
    expect(result.executions).toHaveLength(1);
    expect(mockExecute).toHaveBeenCalled();
  });

  it('审核拒绝时应标记为 reviewing', async () => {
    const anomalies: TraceAnomaly[] = [{
      type: 'high_bypass_rate',
      constraintId: 'test-constraint',
      level: 'guideline',
      message: 'Test',
      data: { currentRate: 0.5, threshold: 0.3 },
      detectedAt: Date.now(),
    }];

    mockDiagnose.mockResolvedValue(makeDiagnosis());
    mockPropose.mockResolvedValue(makeProposal({ id: 'proposal-rejected', risk: { level: 'medium', description: 'Medium risk' } }));
    mockReview.mockReturnValue({ accepted: false, comment: 'Needs human review' } as ProposalReviewResult);

    const { autoEvolve } = await import('../auto-evolve');
    const result = await autoEvolve([], anomalies, { autoApproveLowRisk: true });

    expect(result.autoApproved).toBe(0);
    expect(result.needsReview).toBe(1);
    expect(result.proposals[0].status).toBe('reviewing');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('执行失败时 status 应保持 accepted', async () => {
    const anomalies: TraceAnomaly[] = [{
      type: 'high_bypass_rate',
      constraintId: 'test-constraint',
      level: 'guideline',
      message: 'Test',
      data: { currentRate: 0.5, threshold: 0.3 },
      detectedAt: Date.now(),
    }];

    mockDiagnose.mockResolvedValue(makeDiagnosis());
    mockPropose.mockResolvedValue(makeProposal({ id: 'proposal-fail-exec' }));
    mockReview.mockReturnValue({ accepted: true, comment: 'Auto-approved' } as ProposalReviewResult);
    mockExecute.mockReturnValue({
      proposalId: 'proposal-fail-exec',
      constraintId: 'test-constraint',
      action: 'add_exception',
      success: false,
      details: 'Execution failed',
    } as ExecutionResult);

    const { autoEvolve } = await import('../auto-evolve');
    const result = await autoEvolve([], anomalies);

    expect(result.executions[0].success).toBe(false);
    expect(result.proposals[0].status).toBe('accepted');
  });

  it('审核返回 modifications 时应合并到内容', async () => {
    const anomalies: TraceAnomaly[] = [{
      type: 'high_bypass_rate',
      constraintId: 'test-constraint',
      level: 'guideline',
      message: 'Test',
      data: { currentRate: 0.5, threshold: 0.3 },
      detectedAt: Date.now(),
    }];

    mockDiagnose.mockResolvedValue(makeDiagnosis());
    mockPropose.mockResolvedValue(makeProposal({
      id: 'proposal-mod',
      content: { proposed: 'old_value', description: 'Test' },
    }));
    mockReview.mockReturnValue({
      accepted: false,
      comment: 'Needs moderation',
      modifications: { proposed: 'new_value' },
    } as unknown as ProposalReviewResult);

    const { autoEvolve } = await import('../auto-evolve');
    const result = await autoEvolve([], anomalies);

    expect(result.proposals[0].content.proposed).toBe('new_value');
  });

  it('autoApproveLowRisk=false 时全部进入 reviewing', async () => {
    const anomalies: TraceAnomaly[] = [{
      type: 'high_bypass_rate',
      constraintId: 'test-constraint',
      level: 'guideline',
      message: 'Test',
      data: { currentRate: 0.5, threshold: 0.3 },
      detectedAt: Date.now(),
    }];

    mockDiagnose.mockResolvedValue(makeDiagnosis());
    mockPropose.mockResolvedValue(makeProposal({ id: 'proposal-no-auto' }));
    mockReview.mockReturnValue({ accepted: true, comment: 'Auto-approved' } as ProposalReviewResult);

    const { autoEvolve } = await import('../auto-evolve');
    const result = await autoEvolve([], anomalies, { autoApproveLowRisk: false });

    expect(result.autoApproved).toBe(0);
    expect(result.needsReview).toBe(1);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('多个异常应该都为 auto-evolve 流程', async () => {
    const anomalies: TraceAnomaly[] = [
      {
        type: 'high_bypass_rate',
        constraintId: 'constraint-1',
        level: 'guideline',
        message: 'Test 1',
        data: { currentRate: 0.5, threshold: 0.3 },
        detectedAt: Date.now(),
      },
      {
        type: 'low_pass_rate',
        constraintId: 'constraint-2',
        level: 'guideline',
        message: 'Test 2',
        data: { currentRate: 0.1, threshold: 0.5 },
        detectedAt: Date.now(),
      },
    ];

    mockDiagnose.mockResolvedValue(makeDiagnosis({ constraintId: 'constraint-1' }));
    mockPropose.mockResolvedValue(makeProposal({ id: 'multi-proposal', constraintId: 'constraint-1' }));
    mockReview.mockReturnValue({ accepted: true, comment: 'Auto-approved' } as ProposalReviewResult);
    mockExecute.mockReturnValue({
      proposalId: 'multi-proposal',
      constraintId: 'constraint-1',
      action: 'add_exception',
      success: true,
      details: 'Done',
    } as ExecutionResult);

    const { autoEvolve } = await import('../auto-evolve');
    const result = await autoEvolve([], anomalies);

    expect(result.diagnoses).toHaveLength(2);
    expect(result.proposals).toHaveLength(2);
  });
});
