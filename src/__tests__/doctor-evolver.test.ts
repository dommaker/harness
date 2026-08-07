/**
 * ConstraintDoctor 和 ConstraintEvolver 测试
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TraceCollector } from '../monitoring/traces';
import { TraceAnalyzer } from '../monitoring/trace-analyzer';
import { ConstraintDoctor, createDoctor } from '../monitoring/constraint-doctor';
import { ConstraintEvolver, createEvolver } from '../monitoring/constraint-evolver';
import { getConstraint } from '../core/constraints/definitions';
import type { ExecutionTrace, TraceAnomaly } from '../types/trace';
import type { Diagnosis, ConstraintProposal } from '../types/monitoring-types';

describe('ConstraintDoctor', () => {
  let tempDir: string;
  let collector: TraceCollector;
  let analyzer: TraceAnalyzer;
  let doctor: ConstraintDoctor;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `harness-traces-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    collector = new TraceCollector({
      traceFile: path.join(tempDir, 'execution.log'),
      enabled: true,
    });
    analyzer = new TraceAnalyzer(collector);
    doctor = createDoctor();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  test('should diagnose high bypass rate anomaly', async () => {
    // 创建异常
    const anomaly: TraceAnomaly = {
      type: 'high_bypass_rate',
      constraintId: 'test_constraint',
      level: 'guideline',
      message: 'Bypass rate 40%',
      data: {
        currentRate: 0.4,
        threshold: 0.3,
      },
      detectedAt: Date.now(),
      suggestedAction: 'diagnose',
    };

    // 添加 traces
    const traces: ExecutionTrace[] = [];
    for (let i = 0; i < 10; i++) {
      traces.push({
        constraintId: 'test_constraint',
        level: 'guideline',
        timestamp: Date.now() - i * 60 * 1000,
        result: i < 6 ? 'bypassed' : 'pass',
      });
    }
    doctor.setData(traces);

    // 诊断
    const diagnosis = await doctor.diagnose(anomaly);

    expect(diagnosis.constraintId).toBe('test_constraint');
    expect(diagnosis.needsChange).toBe(true);
    expect(diagnosis.rootCause.primary).toContain('过于严格');
    expect(diagnosis.recommendations.length).toBeGreaterThan(0);
    expect(diagnosis.recommendations[0].type).toBe('add_exception');
  });

  test('should diagnose rising fail rate anomaly', async () => {
    const anomaly: TraceAnomaly = {
      type: 'rising_fail_rate',
      constraintId: 'another_constraint',
      level: 'iron_law',
      message: 'Fail rate rising',
      data: {
        currentRate: 0.6,
        threshold: 0.5,
        trend: 'rising',
      },
      detectedAt: Date.now(),
      suggestedAction: 'diagnose',
    };

    doctor.setData([]);
    const diagnosis = await doctor.diagnose(anomaly);

    expect(diagnosis.needsChange).toBe(true);
    expect(diagnosis.impact.severity).toBe('high'); // Iron law
    expect(diagnosis.urgency).toBe('medium'); // Iron law 强制 medium+
  });

  test('should detect exception overuse', async () => {
    const anomaly: TraceAnomaly = {
      type: 'exception_overuse',
      constraintId: 'constraint_with_exceptions',
      level: 'guideline',
      message: 'Exception rate 50%',
      data: {
        currentRate: 0.5,
        threshold: 0.4,
      },
      detectedAt: Date.now(),
      suggestedAction: 'add_exception',
    };

    doctor.setData([]);
    const diagnosis = await doctor.diagnose(anomaly);

    expect(diagnosis.rootCause.primary).toContain('过度使用');
    expect(diagnosis.recommendations[0].type).toBe('modify_constraint');
  });

  test('should generate diagnosis report', async () => {
    const anomaly: TraceAnomaly = {
      type: 'high_bypass_rate',
      constraintId: 'test',
      level: 'guideline',
      message: 'Test',
      data: {
        currentRate: 0.5,
        threshold: 0.3,
      },
      detectedAt: Date.now(),
      suggestedAction: 'diagnose',
    };

    doctor.setData([]);
    const diagnosis = await doctor.diagnose(anomaly);
    const report = doctor.generateReport(diagnosis);

    expect(report).toContain('# Diagnosis Report');
    expect(report).toContain('Root Cause');
    expect(report).toContain('Recommendations');
    expect(report).toContain('test');
  });

  test('should save and load diagnosis', async () => {
    const anomaly: TraceAnomaly = {
      type: 'high_bypass_rate',
      constraintId: 'save_test',
      level: 'guideline',
      message: 'Test',
      data: { currentRate: 0.5, threshold: 0.3 },
      detectedAt: Date.now(),
      suggestedAction: 'diagnose',
    };

    doctor.setData([]);
    const diagnosis = await doctor.diagnose(anomaly);

    const outputPath = path.join(tempDir, 'diagnosis.json');
    doctor.saveDiagnosis(diagnosis, outputPath);

    expect(fs.existsSync(outputPath)).toBe(true);

    const loaded = doctor.loadDiagnosis(outputPath);
    expect(loaded.constraintId).toBe('save_test');
    expect(loaded.needsChange).toBe(true);
  });
});

describe('ConstraintEvolver', () => {
  let tempDir: string;
  let evolver: ConstraintEvolver;
  let doctor: ConstraintDoctor;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `harness-proposals-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    evolver = createEvolver(tempDir, getConstraint);
    doctor = createDoctor();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  test('should propose from diagnosis', async () => {
    const diagnosis: Diagnosis = {
      anomalyId: 'test-anomaly-1',
      constraintId: 'no_fix_without_root_cause',
      diagnosedAt: Date.now(),
      rootCause: {
        primary: '约束过于严格',
        secondary: ['缺少例外条件'],
        evidence: [],
      },
      impact: {
        severity: 'medium',
        scope: 'single_project',
        userImpact: '用户频繁绕过',
      },
      recommendations: [
        {
          type: 'add_exception',
          content: '添加 typo 例外',
          expectedOutcome: '绕过率降低',
          implementationCost: 'low',
        },
      ],
      needsChange: true,
      urgency: 'medium',
    };

    const proposal = await evolver.propose(diagnosis);

    expect(proposal).not.toBeNull();
    expect(proposal!.constraintId).toBe('no_fix_without_root_cause');
    expect(proposal!.type).toBe('add_exception');
    expect(proposal!.status).toBe('proposed');
  });

  test('should not propose for diagnosis without change', async () => {
    const diagnosis: Diagnosis = {
      anomalyId: 'no-change',
      constraintId: 'some_constraint',
      diagnosedAt: Date.now(),
      rootCause: {
        primary: '正常',
        evidence: [],
      },
      impact: {
        severity: 'low',
        scope: 'single_project',
        userImpact: '无',
      },
      recommendations: [],
      needsChange: false,
      urgency: 'low',
    };

    const proposal = await evolver.propose(diagnosis);
    expect(proposal).toBeNull();
  });

  test('should review low risk proposal', async () => {
    const proposal: ConstraintProposal = {
      id: 'test-proposal-1',
      proposedAt: Date.now(),
      diagnosisId: 'test-anomaly',
      constraintId: 'some_guideline',
      type: 'add_exception',
      content: {
        proposed: 'new_exception',
        description: 'Add exception',
      },
      reasoning: 'Test',
      expectedOutcome: 'Better',
      risk: { level: 'low', description: 'Low risk' },
      implementation: { files: [], linesChanged: 5, testsRequired: true },
      status: 'proposed',
    };

    const review = evolver.review(proposal);
    expect(review.accepted).toBe(true);
  });

  test('should review iron_law modification carefully', async () => {
    const proposal: ConstraintProposal = {
      id: 'iron-law-proposal',
      proposedAt: Date.now(),
      diagnosisId: 'iron-anomaly',
      constraintId: 'no_self_approval', // Iron law that exists
      type: 'modify_message', // Not add_exception
      content: {
        proposed: 'Change message',
        description: 'Modify iron law',
      },
      reasoning: 'Test',
      expectedOutcome: 'Test',
      risk: { level: 'medium', description: 'Medium risk' },
      implementation: { files: [], linesChanged: 10, testsRequired: true },
      status: 'proposed',
    };

    const review = evolver.review(proposal);
    expect(review.accepted).toBe(false);
    expect(review.comment).toContain('Iron Law');
  });

  test('should generate implementation instructions', async () => {
    const proposal: ConstraintProposal = {
      id: 'impl-test',
      proposedAt: Date.now(),
      diagnosisId: 'test',
      constraintId: 'some_constraint',
      type: 'add_exception',
      content: {
        proposed: 'new_exception',
        description: 'Add exception',
      },
      reasoning: 'Test',
      expectedOutcome: 'Test',
      risk: { level: 'low', description: 'Low risk' },
      implementation: { files: ['definitions.ts'], linesChanged: 5, testsRequired: true },
      status: 'accepted',
    };

    const impl = evolver.implement(proposal);

    expect(impl.instructions.length).toBeGreaterThan(0);
    expect(impl.filesToModify).toContain('src/core/constraints/definitions.ts');
    expect(impl.testsToRun.length).toBeGreaterThan(0);
  });

  test('should save and load proposal', async () => {
    const proposal: ConstraintProposal = {
      id: 'save-test',
      proposedAt: Date.now(),
      diagnosisId: 'test',
      constraintId: 'test_constraint',
      type: 'add_exception',
      content: { proposed: 'test', description: 'Test' },
      reasoning: 'Test',
      expectedOutcome: 'Test',
      risk: { level: 'low', description: 'Low' },
      implementation: { files: [], linesChanged: 1, testsRequired: false },
      status: 'proposed',
    };

    evolver.saveProposal(proposal);

    const loaded = evolver.loadProposal('save-test');
    expect(loaded.constraintId).toBe('test_constraint');
    expect(loaded.status).toBe('proposed');
  });

  test('should list proposals', async () => {
    const proposal: ConstraintProposal = {
      id: 'list-test',
      proposedAt: Date.now(),
      diagnosisId: 'test',
      constraintId: 'test',
      type: 'add_exception',
      content: { proposed: 'test', description: 'Test' },
      reasoning: 'Test',
      expectedOutcome: 'Test',
      risk: { level: 'low', description: 'Low' },
      implementation: { files: [], linesChanged: 1, testsRequired: false },
      status: 'proposed',
    };

    evolver.saveProposal(proposal);

    const proposals = evolver.listProposals('proposed');
    expect(proposals.length).toBe(1);
    expect(proposals[0].id).toBe('list-test');
  });

  test('should update proposal status', async () => {
    const proposal: ConstraintProposal = {
      id: 'status-test',
      proposedAt: Date.now(),
      diagnosisId: 'test',
      constraintId: 'test',
      type: 'add_exception',
      content: { proposed: 'test', description: 'Test' },
      reasoning: 'Test',
      expectedOutcome: 'Test',
      risk: { level: 'low', description: 'Low' },
      implementation: { files: [], linesChanged: 1, testsRequired: false },
      status: 'proposed',
    };

    evolver.saveProposal(proposal);
    evolver.updateProposalStatus('status-test', 'accepted', 'Looks good');

    const loaded = evolver.loadProposal('status-test');
    expect(loaded.status).toBe('accepted');
    expect(loaded.reviewComment).toBe('Looks good');
  });
});