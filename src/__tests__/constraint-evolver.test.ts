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