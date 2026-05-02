/**
 * 约束生命周期执行器
 *
 * 将 ConstraintEvolver 生成的提案转化为 ConstraintRegistry 实际操作。
 * 连接 monitoring 层（proposal）和 constraints 层（registry）。
 */

import { ConstraintRegistry } from './registry';
import type { ConstraintProposal } from '../monitoring/constraint-evolver';
import type { ConstraintLevel } from '../types/constraint';
import type { DeprecationSchedule } from './types';

/**
 * 提案执行结果
 */
export interface ExecutionResult {
  proposalId: string;
  constraintId: string;
  action: string;
  success: boolean;
  details: string;
}

/**
 * 约束生命周期执行器
 *
 * 将 evolver 的提案（proposal）转化为 registry 的实际操作（degrade/rollback/scheduleDeprecation）
 */
export class ConstraintLifecycleRunner {
  private registry: ConstraintRegistry;

  constructor(registry?: ConstraintRegistry) {
    this.registry = registry || new ConstraintRegistry();
  }

  getRegistry(): ConstraintRegistry {
    return this.registry;
  }

  /**
   * 执行单个已接受的提案
   */
  execute(proposal: ConstraintProposal): ExecutionResult {
    switch (proposal.type) {
      case 'change_level':
        return this.executeLevelChange(proposal);
      case 'add_exception':
        return this.executeAddException(proposal);
      case 'adjust_trigger':
        return this.executeAdjustTrigger(proposal);
      case 'modify_message':
        return this.executeModifyMessage(proposal);
      default:
        return {
          proposalId: proposal.id,
          constraintId: proposal.constraintId,
          action: proposal.type,
          success: false,
          details: `Unsupported proposal type: ${proposal.type}`,
        };
    }
  }

  /**
   * 批量执行提案
   */
  executeBatch(proposals: ConstraintProposal[]): ExecutionResult[] {
    return proposals.map(p => this.execute(p));
  }

  /**
   * 回滚已降级的约束
   */
  rollbackConstraint(constraintId: string, originalLevel: ConstraintLevel): boolean {
    return this.registry.rollback(constraintId, originalLevel);
  }

  /**
   * 设置约束的弃用计划
   */
  scheduleDeprecation(constraintId: string, schedule: DeprecationSchedule): boolean {
    return this.registry.scheduleDeprecation(constraintId, schedule);
  }

  private executeLevelChange(proposal: ConstraintProposal): ExecutionResult {
    const constraint = this.registry.get(proposal.constraintId);
    if (!constraint) {
      return this.failResult(proposal, `Constraint ${proposal.constraintId} not found`);
    }

    if (constraint.layer === 'safety') {
      return this.failResult(proposal, 'Cannot change level of safety-layer constraint');
    }

    const targetLevel = proposal.content.proposed as ConstraintLevel;
    const currentLevel = constraint.level;

    const levelOrder: Record<string, number> = { iron_law: 0, guideline: 1, tip: 2 };
    if ((levelOrder[targetLevel] ?? 99) > (levelOrder[currentLevel] ?? 0)) {
      const success = this.registry.degrade(proposal.constraintId);
      return {
        proposalId: proposal.id,
        constraintId: proposal.constraintId,
        action: 'degrade',
        success,
        details: success
          ? `Degraded from ${currentLevel} to ${targetLevel}`
          : 'Degradation failed',
      };
    }

    return this.failResult(proposal, 'Level change direction not supported via registry');
  }

  private executeAddException(proposal: ConstraintProposal): ExecutionResult {
    const constraint = this.registry.get(proposal.constraintId);
    if (!constraint) {
      return this.failResult(proposal, `Constraint ${proposal.constraintId} not found`);
    }

    const exception = proposal.content.proposed;
    const currentExceptions = constraint.exceptions || [];

    if (currentExceptions.includes(exception)) {
      return this.failResult(proposal, `Exception ${exception} already exists`);
    }

    if (!constraint.exceptions) constraint.exceptions = [];
    constraint.exceptions.push(exception);

    return {
      proposalId: proposal.id,
      constraintId: proposal.constraintId,
      action: 'add_exception',
      success: true,
      details: `Added exception: ${exception}`,
    };
  }

  private executeAdjustTrigger(proposal: ConstraintProposal): ExecutionResult {
    const constraint = this.registry.get(proposal.constraintId);
    if (!constraint) {
      return this.failResult(proposal, `Constraint ${proposal.constraintId} not found`);
    }

    const oldTrigger = constraint.trigger;
    constraint.trigger = proposal.content.proposed;

    return {
      proposalId: proposal.id,
      constraintId: proposal.constraintId,
      action: 'adjust_trigger',
      success: true,
      details: `Changed trigger from ${JSON.stringify(oldTrigger)} to ${JSON.stringify(proposal.content.proposed)}`,
    };
  }

  private executeModifyMessage(proposal: ConstraintProposal): ExecutionResult {
    const constraint = this.registry.get(proposal.constraintId);
    if (!constraint) {
      return this.failResult(proposal, `Constraint ${proposal.constraintId} not found`);
    }

    constraint.message = proposal.content.proposed;

    return {
      proposalId: proposal.id,
      constraintId: proposal.constraintId,
      action: 'modify_message',
      success: true,
      details: 'Updated message',
    };
  }

  private failResult(proposal: ConstraintProposal, details: string): ExecutionResult {
    return {
      proposalId: proposal.id,
      constraintId: proposal.constraintId,
      action: proposal.type,
      success: false,
      details,
    };
  }
}
