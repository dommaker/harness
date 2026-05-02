/**
 * ConstraintLifecycleRunner 测试
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { ConstraintLifecycleRunner, type ExecutionResult } from '../lifecycle-runner';
import { ConstraintRegistry } from '../registry';
import type { ConstraintProposal } from '../../monitoring/constraint-evolver';

function makeProposal(overrides: Partial<ConstraintProposal> = {}): ConstraintProposal {
  return {
    id: 'test-proposal-1',
    proposedAt: Date.now(),
    diagnosisId: 'diag-1',
    constraintId: 'no_fix_without_root_cause',
    type: 'change_level',
    content: { proposed: 'tip', description: '降级为 tip' },
    reasoning: 'low intercept rate',
    expectedOutcome: 'fewer interruptions',
    risk: { level: 'low', description: 'safe' },
    implementation: { files: [], linesChanged: 0, testsRequired: false },
    status: 'accepted',
    ...overrides,
  };
}

describe('ConstraintLifecycleRunner', () => {
  let runner: ConstraintLifecycleRunner;
  let registry: ConstraintRegistry;

  beforeEach(() => {
    registry = new ConstraintRegistry();
    runner = new ConstraintLifecycleRunner(registry);
  });

  describe('execute - change_level', () => {
    it('应该成功降级质量层约束', () => {
      const proposal = makeProposal({
        constraintId: 'no_fix_without_root_cause',
        type: 'change_level',
        content: { proposed: 'tip', description: '降级' },
      });

      const result = runner.execute(proposal);

      expect(result.success).toBe(true);
      expect(result.action).toBe('degrade');
      expect(result.details).toContain('Degraded');

      // 验证 registry 状态已改变
      const constraint = registry.get('no_fix_without_root_cause');
      expect(constraint?.deprecationStatus).toBe('deprecated');
    });

    it('应该拒绝安全层约束的 level 变更', () => {
      const proposal = makeProposal({
        constraintId: 'no_bypass_checkpoint',
        type: 'change_level',
        content: { proposed: 'guideline', description: '降级' },
      });

      const result = runner.execute(proposal);

      expect(result.success).toBe(false);
      expect(result.details).toContain('safety-layer');
    });

    it('应该返回失败当约束不存在', () => {
      const proposal = makeProposal({
        constraintId: 'nonexistent_constraint',
        type: 'change_level',
        content: { proposed: 'tip', description: '降级' },
      });

      const result = runner.execute(proposal);

      expect(result.success).toBe(false);
      expect(result.details).toContain('not found');
    });
  });

  describe('execute - add_exception', () => {
    it('应该成功添加例外', () => {
      const proposal = makeProposal({
        constraintId: 'no_fix_without_root_cause',
        type: 'add_exception',
        content: { proposed: 'new_exception', description: '新增例外' },
      });

      const result = runner.execute(proposal);

      expect(result.success).toBe(true);
      expect(result.action).toBe('add_exception');
      expect(result.details).toContain('new_exception');

      const constraint = registry.get('no_fix_without_root_cause');
      expect(constraint?.exceptions).toContain('new_exception');
    });

    it('应该拒绝重复的例外', () => {
      const proposal = makeProposal({
        constraintId: 'no_fix_without_root_cause',
        type: 'add_exception',
        content: { proposed: 'simple_typo', description: '重复例外' },
      });

      const result = runner.execute(proposal);

      expect(result.success).toBe(false);
      expect(result.details).toContain('already exists');
    });
  });

  describe('execute - adjust_trigger', () => {
    it('应该成功修改触发条件', () => {
      const proposal = makeProposal({
        constraintId: 'no_fix_without_root_cause',
        type: 'adjust_trigger',
        content: { proposed: ['bug_fix_attempt', 'code_implementation'], description: '扩展触发' },
      });

      const result = runner.execute(proposal);

      expect(result.success).toBe(true);
      expect(result.action).toBe('adjust_trigger');

      const constraint = registry.get('no_fix_without_root_cause');
      expect(constraint?.trigger).toEqual(['bug_fix_attempt', 'code_implementation']);
    });
  });

  describe('execute - modify_message', () => {
    it('应该成功修改消息', () => {
      const proposal = makeProposal({
        constraintId: 'no_fix_without_root_cause',
        type: 'modify_message',
        content: { proposed: '新的消息', description: '更新消息' },
      });

      const result = runner.execute(proposal);

      expect(result.success).toBe(true);
      expect(result.action).toBe('modify_message');

      const constraint = registry.get('no_fix_without_root_cause');
      expect(constraint?.message).toBe('新的消息');
    });
  });

  describe('execute - unsupported type', () => {
    it('应该拒绝不支持的提案类型', () => {
      const proposal = makeProposal({
        type: 'new_constraint' as any,
      });

      const result = runner.execute(proposal);

      expect(result.success).toBe(false);
      expect(result.details).toContain('Unsupported');
    });
  });

  describe('executeBatch', () => {
    it('应该批量执行多个提案', () => {
      const proposals = [
        makeProposal({
          id: 'p1',
          constraintId: 'no_fix_without_root_cause',
          type: 'modify_message',
          content: { proposed: '消息1', description: '更新' },
        }),
        makeProposal({
          id: 'p2',
          constraintId: 'no_code_without_test',
          type: 'modify_message',
          content: { proposed: '消息2', description: '更新' },
        }),
      ];

      const results = runner.executeBatch(proposals);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });
  });

  describe('rollbackConstraint', () => {
    it('应该成功回滚已降级的约束', () => {
      // 先降级
      const proposal = makeProposal({
        constraintId: 'no_fix_without_root_cause',
        type: 'change_level',
        content: { proposed: 'tip', description: '降级' },
      });
      runner.execute(proposal);

      const constraint = registry.get('no_fix_without_root_cause');
      expect(constraint?.deprecationStatus).toBe('deprecated');

      // 回滚
      const success = runner.rollbackConstraint('no_fix_without_root_cause', 'guideline');
      expect(success).toBe(true);

      const after = registry.get('no_fix_without_root_cause');
      expect(after?.deprecationStatus).toBe('active');
      expect(after?.level).toBe('guideline');
    });
  });

  describe('scheduleDeprecation', () => {
    it('应该成功设置弃用计划', () => {
      const success = runner.scheduleDeprecation('no_fix_without_root_cause', {
        targetLevel: 'tip',
        reason: 'low usage',
        rollbackable: true,
      });

      expect(success).toBe(true);

      const constraint = registry.get('no_fix_without_root_cause');
      expect(constraint?.deprecationStatus).toBe('scheduled');
    });

    it('应该拒绝安全层约束的弃用计划', () => {
      const success = runner.scheduleDeprecation('no_bypass_checkpoint', {
        targetLevel: 'guideline',
        reason: 'test',
        rollbackable: false,
      });

      expect(success).toBe(false);
    });
  });

  describe('getRegistry', () => {
    it('应该返回内部 registry 实例', () => {
      expect(runner.getRegistry()).toBe(registry);
    });

    it('应该在无参数时创建默认 registry', () => {
      const defaultRunner = new ConstraintLifecycleRunner();
      expect(defaultRunner.getRegistry()).toBeDefined();
    });
  });
});
