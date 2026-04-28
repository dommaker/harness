/**
 * constraint-evolver 测试
 */

import { describe, it, expect } from '@jest/globals';
import { ConstraintEvolver } from '../monitoring/constraint-evolver';
import type { Diagnosis } from '../monitoring/constraint-doctor';

describe('ConstraintEvolver', () => {
  describe('constructor', () => {
    it('应该创建实例', () => {
      const evolver = new ConstraintEvolver();
      expect(evolver).toBeDefined();
    });

    it('支持自定义 proposalsDir', () => {
      const evolver = new ConstraintEvolver('/tmp/test-proposals');
      expect(evolver).toBeDefined();
    });
  });

  describe('propose', () => {
    it('应该根据诊断生成提案', async () => {
      const evolver = new ConstraintEvolver();

      const diagnosis: Diagnosis = {
        anomalyId: 'anomaly-001',
        constraintId: 'no_fix_without_root_cause',
        diagnosedAt: Date.now(),
        rootCause: {
          primary: '例外使用过多',
          evidence: [],
        },
        impact: {
          severity: 'medium',
          scope: 'single_project',
          userImpact: '质量下降',
        },
        recommendations: [
          {
            type: 'add_exception',
            content: '添加 simple_typo 例外',
            expectedOutcome: '减少误报',
            implementationCost: 'low',
          },
        ],
        needsChange: true,
        urgency: 'medium',
      };

      const proposal = await evolver.propose(diagnosis);

      expect(proposal).toBeDefined();
      expect(proposal?.constraintId).toBe('no_fix_without_root_cause');
    });

    it('needsChange=false 应该返回 null', async () => {
      const evolver = new ConstraintEvolver();

      const diagnosis: Diagnosis = {
        anomalyId: 'anomaly-no-change',
        constraintId: 'test_constraint',
        diagnosedAt: Date.now(),
        rootCause: { primary: '正常', evidence: [] },
        impact: { severity: 'low', scope: 'single_project', userImpact: '无' },
        recommendations: [],
        needsChange: false,
        urgency: 'low',
      };

      const proposal = await evolver.propose(diagnosis);
      expect(proposal).toBeNull();
    });

    it('recommendations 为空应该返回 null', async () => {
      const evolver = new ConstraintEvolver();

      const diagnosis: Diagnosis = {
        anomalyId: 'anomaly-no-rec',
        constraintId: 'test_constraint',
        diagnosedAt: Date.now(),
        rootCause: { primary: '测试', evidence: [] },
        impact: { severity: 'medium', scope: 'single_project', userImpact: '测试' },
        recommendations: [],
        needsChange: true,
        urgency: 'medium',
      };

      const proposal = await evolver.propose(diagnosis);
      expect(proposal).toBeNull();
    });

    it('应该处理 adjust_threshold 类型', async () => {
      const evolver = new ConstraintEvolver();

      const diagnosis: Diagnosis = {
        anomalyId: 'anomaly-002',
        constraintId: 'no_fix_without_root_cause',
        diagnosedAt: Date.now(),
        rootCause: { primary: '触发条件过宽', evidence: [] },
        impact: { severity: 'low', scope: 'single_project', userImpact: '少量误报' },
        recommendations: [
          { type: 'adjust_threshold', content: '缩小触发范围', expectedOutcome: '减少误报', implementationCost: 'low' },
        ],
        needsChange: true,
        urgency: 'low',
      };

      const proposal = await evolver.propose(diagnosis);
      expect(proposal).toBeDefined();
      expect(proposal?.type).toBe('adjust_trigger');
    });

    it('应该处理 modify_constraint 类型', async () => {
      const evolver = new ConstraintEvolver();

      const diagnosis: Diagnosis = {
        anomalyId: 'anomaly-003',
        constraintId: 'no_fix_without_root_cause',
        diagnosedAt: Date.now(),
        rootCause: { primary: '消息不清晰', evidence: [] },
        impact: { severity: 'low', scope: 'single_project', userImpact: '用户体验差' },
        recommendations: [
          { type: 'modify_constraint', content: '优化提示消息', expectedOutcome: '更清晰', implementationCost: 'low' },
        ],
        needsChange: true,
        urgency: 'low',
      };

      const proposal = await evolver.propose(diagnosis);
      expect(proposal).toBeDefined();
      expect(proposal?.type).toBe('modify_message');
    });
  });

  describe('proposeBatch', () => {
    it('应该批量生成提案', async () => {
      const evolver = new ConstraintEvolver();

      const diagnoses: Diagnosis[] = [
        {
          anomalyId: 'batch-001',
          constraintId: 'no_fix_without_root_cause',
          diagnosedAt: Date.now(),
          rootCause: { primary: '测试1', evidence: [] },
          impact: { severity: 'low', scope: 'single_project', userImpact: '无' },
          recommendations: [{ type: 'add_exception', content: 'test', expectedOutcome: 'ok', implementationCost: 'low' }],
          needsChange: true,
          urgency: 'low',
        },
        {
          anomalyId: 'batch-002',
          constraintId: 'no_code_without_test',
          diagnosedAt: Date.now(),
          rootCause: { primary: '测试2', evidence: [] },
          impact: { severity: 'low', scope: 'single_project', userImpact: '无' },
          recommendations: [{ type: 'add_exception', content: 'test', expectedOutcome: 'ok', implementationCost: 'low' }],
          needsChange: true,
          urgency: 'low',
        },
        {
          anomalyId: 'batch-003',
          constraintId: 'unknown_constraint',
          diagnosedAt: Date.now(),
          rootCause: { primary: '测试3', evidence: [] },
          impact: { severity: 'low', scope: 'single_project', userImpact: '无' },
          recommendations: [],
          needsChange: false,
          urgency: 'low',
        },
      ];

      const proposals = await evolver.proposeBatch(diagnoses);
      expect(proposals.length).toBe(2);
    });
  });

  describe('review', () => {
    it('Iron Law 非添加例外应该被拒绝', async () => {
      const evolver = new ConstraintEvolver();

      const diagnosis: Diagnosis = {
        anomalyId: 'review-001',
        constraintId: 'no_bypass_checkpoint',  // iron_law
        diagnosedAt: Date.now(),
        rootCause: { primary: '测试', evidence: [] },
        impact: { severity: 'high', scope: 'single_project', userImpact: '严重' },
        recommendations: [{ type: 'modify_constraint', content: '修改消息', expectedOutcome: '更清晰', implementationCost: 'low' }],
        needsChange: true,
        urgency: 'high',
      };

      const proposal = await evolver.propose(diagnosis);
      const review = evolver.review(proposal!);

      expect(review.accepted).toBe(false);
      expect(review.comment).toContain('Iron Law');
    });

    it('高风险提案应该被拒绝', async () => {
      const evolver = new ConstraintEvolver();

      const diagnosis: Diagnosis = {
        anomalyId: 'review-002',
        constraintId: 'no_fix_without_root_cause',
        diagnosedAt: Date.now(),
        rootCause: { primary: '高风险', evidence: [] },
        impact: { severity: 'high', scope: 'multiple_projects', userImpact: '严重' },
        recommendations: [{ type: 'add_exception', content: 'test', expectedOutcome: '高风险', implementationCost: 'high' }],
        needsChange: true,
        urgency: 'high',
      };

      const proposal = await evolver.propose(diagnosis);
      const review = evolver.review(proposal!);

      expect(review.accepted).toBe(false);
      expect(review.comment).toContain('高风险');
    });

    it('低风险 + 有测试应该通过', async () => {
      const evolver = new ConstraintEvolver();

      const diagnosis: Diagnosis = {
        anomalyId: 'review-003',
        constraintId: 'no_fix_without_root_cause',
        diagnosedAt: Date.now(),
        rootCause: { primary: '低风险变更', evidence: [] },
        impact: { severity: 'low', scope: 'single_project', userImpact: '无' },
        recommendations: [{ type: 'add_exception', content: 'test', expectedOutcome: '低风险', implementationCost: 'low' }],
        needsChange: true,
        urgency: 'low',
      };

      const proposal = await evolver.propose(diagnosis);
      const review = evolver.review(proposal!);

      expect(review.accepted).toBe(true);
    });

    it('中风险需要人工审核', async () => {
      const evolver = new ConstraintEvolver();

      const diagnosis: Diagnosis = {
        anomalyId: 'review-004',
        constraintId: 'no_fix_without_root_cause',
        diagnosedAt: Date.now(),
        rootCause: { primary: '中风险', evidence: [] },
        impact: { severity: 'medium', scope: 'single_project', userImpact: '中等' },
        recommendations: [{ type: 'adjust_threshold', content: 'test', expectedOutcome: '中风险', implementationCost: 'high' }],
        needsChange: true,
        urgency: 'medium',
      };

      const proposal = await evolver.propose(diagnosis);
      const review = evolver.review(proposal!);

      expect(review.accepted).toBe(false);
      expect(review.comment).toContain('人工审核');
    });
  });

  describe('implement', () => {
    it('add_exception 应该生成正确指令', async () => {
      const evolver = new ConstraintEvolver();

      const diagnosis: Diagnosis = {
        anomalyId: 'impl-001',
        constraintId: 'no_fix_without_root_cause',
        diagnosedAt: Date.now(),
        rootCause: { primary: '测试', evidence: [] },
        impact: { severity: 'low', scope: 'single_project', userImpact: '无' },
        recommendations: [{ type: 'add_exception', content: 'test_exception', expectedOutcome: 'ok', implementationCost: 'low' }],
        needsChange: true,
        urgency: 'low',
      };

      const proposal = await evolver.propose(diagnosis);
      const impl = evolver.implement(proposal!);

      expect(impl.instructions.length).toBeGreaterThan(0);
      expect(impl.filesToModify).toContain('src/core/constraints/definitions.ts');
    });

    it('remove_exception 应该生成正确指令', async () => {
      const evolver = new ConstraintEvolver();

      const proposal = {
        id: 'test-remove',
        proposedAt: Date.now(),
        diagnosisId: 'diag-001',
        constraintId: 'test',
        type: 'remove_exception' as const,
        content: { proposed: 'old_exception', description: 'test' },
        reasoning: 'test',
        expectedOutcome: 'ok',
        risk: { level: 'low' as const, description: 'test' },
        implementation: { files: ['test.ts'], linesChanged: 5, testsRequired: true },
        status: 'proposed' as const,
      };

      const impl = evolver.implement(proposal);
      expect(impl.instructions.some(i => i.includes('移除'))).toBe(true);
    });

    it('adjust_trigger 应该生成正确指令', async () => {
      const evolver = new ConstraintEvolver();

      const proposal = {
        id: 'test-adjust',
        proposedAt: Date.now(),
        diagnosisId: 'diag-002',
        constraintId: 'test',
        type: 'adjust_trigger' as const,
        content: { current: 'old_trigger', proposed: 'new_trigger', description: 'test' },
        reasoning: 'test',
        expectedOutcome: 'ok',
        risk: { level: 'low' as const, description: 'test' },
        implementation: { files: ['test.ts'], linesChanged: 5, testsRequired: true },
        status: 'proposed' as const,
      };

      const impl = evolver.implement(proposal);
      expect(impl.instructions.some(i => i.includes('调整'))).toBe(true);
    });

    it('change_level 应该生成正确指令', async () => {
      const evolver = new ConstraintEvolver();

      const proposal = {
        id: 'test-level',
        proposedAt: Date.now(),
        diagnosisId: 'diag-003',
        constraintId: 'test',
        type: 'change_level' as const,
        content: { current: 'iron_law', proposed: 'guideline', description: 'test' },
        reasoning: 'test',
        expectedOutcome: 'ok',
        risk: { level: 'low' as const, description: 'test' },
        implementation: { files: ['test.ts'], linesChanged: 5, testsRequired: true },
        status: 'proposed' as const,
      };

      const impl = evolver.implement(proposal);
      expect(impl.instructions.some(i => i.includes('层级'))).toBe(true);
    });

    it('modify_message 应该生成正确指令', async () => {
      const evolver = new ConstraintEvolver();

      const proposal = {
        id: 'test-msg',
        proposedAt: Date.now(),
        diagnosisId: 'diag-004',
        constraintId: 'test',
        type: 'modify_message' as const,
        content: { current: 'old msg', proposed: 'new msg', description: 'test' },
        reasoning: 'test',
        expectedOutcome: 'ok',
        risk: { level: 'low' as const, description: 'test' },
        implementation: { files: ['test.ts'], linesChanged: 5, testsRequired: true },
        status: 'proposed' as const,
      };

      const impl = evolver.implement(proposal);
      expect(impl.instructions.some(i => i.includes('修改'))).toBe(true);
    });

    it('new_constraint 应该生成正确指令', async () => {
      const evolver = new ConstraintEvolver();

      const proposal = {
        id: 'test-new',
        proposedAt: Date.now(),
        diagnosisId: 'diag-005',
        constraintId: 'test',
        type: 'new_constraint' as const,
        content: { proposed: { id: 'new_constraint', level: 'guideline', rule: 'test' }, description: 'test' },
        reasoning: 'test',
        expectedOutcome: 'ok',
        risk: { level: 'low' as const, description: 'test' },
        implementation: { files: ['test.ts'], linesChanged: 20, testsRequired: true },
        status: 'proposed' as const,
      };

      const impl = evolver.implement(proposal);
      expect(impl.filesToModify.length).toBeGreaterThan(1);
    });
  });

  describe('listProposals', () => {
    it('应该返回所有提案', () => {
      const evolver = new ConstraintEvolver();
      const proposals = evolver.listProposals();
      expect(Array.isArray(proposals)).toBe(true);
    });

    it('应该返回待审核提案', () => {
      const evolver = new ConstraintEvolver();
      const pending = evolver.listProposals('proposed');
      expect(Array.isArray(pending)).toBe(true);
    });
  });
});