/**
 * 基于规则的确定性验证
 *
 * 执行 test / lint / typecheck / custom 规则
 * 纯确定性验证，不依赖 LLM
 */

import { execSync } from 'child_process';
import type {
  VerificationRule,
  VerificationContext,
  VerificationResult,
  VerificationRuleType,
} from './types';

export class RulesBasedVerification {
  private rules: VerificationRule[];

  constructor(rules: VerificationRule[]) {
    this.rules = rules;
  }

  /**
   * 执行所有规则验证
   */
  async verifyAll(context: VerificationContext): Promise<VerificationResult[]> {
    const results: VerificationResult[] = [];

    for (const rule of this.rules) {
      const result = await this.verifyRule(rule, context);
      results.push(result);
    }

    return results;
  }

  /**
   * 执行单条规则验证
   */
  async verifyRule(rule: VerificationRule, context: VerificationContext): Promise<VerificationResult> {
    const start = Date.now();

    try {
      switch (rule.type) {
        case 'test':
        case 'lint':
        case 'typecheck':
          return await this.executeCommand(rule, context, start);
        case 'custom':
          return await this.executeCustom(rule, context, start);
        default:
          return {
            passed: false,
            ruleId: rule.id,
            message: `未知的规则类型: ${rule.type}`,
            duration: Date.now() - start,
          };
      }
    } catch (error) {
      return {
        passed: false,
        ruleId: rule.id,
        message: `验证执行失败: ${error instanceof Error ? error.message : String(error)}`,
        duration: Date.now() - start,
      };
    }
  }

  /**
   * 执行命令类规则
   */
  private async executeCommand(
    rule: VerificationRule,
    context: VerificationContext,
    start: number,
  ): Promise<VerificationResult> {
    if (!rule.command) {
      return {
        passed: false,
        ruleId: rule.id,
        message: `规则 ${rule.id} 缺少 command`,
        duration: Date.now() - start,
      };
    }

    try {
      const output = execSync(rule.command, {
        cwd: context.projectRoot,
        timeout: rule.timeout ?? 30000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      return {
        passed: true,
        ruleId: rule.id,
        message: `${rule.name} 通过`,
        details: output.slice(0, 1000),
        duration: Date.now() - start,
      };
    } catch (error: unknown) {
      const execError = error as { status?: number; stderr?: string; stdout?: string };
      return {
        passed: false,
        ruleId: rule.id,
        message: `${rule.name} 失败 (exit ${execError.status ?? 'unknown'})`,
        details: (execError.stderr ?? execError.stdout ?? '').slice(0, 1000),
        duration: Date.now() - start,
      };
    }
  }

  /**
   * 执行自定义规则
   */
  private async executeCustom(
    rule: VerificationRule,
    context: VerificationContext,
    start: number,
  ): Promise<VerificationResult> {
    if (!rule.verify) {
      return {
        passed: false,
        ruleId: rule.id,
        message: `规则 ${rule.id} 缺少 verify 函数`,
        duration: Date.now() - start,
      };
    }

    return rule.verify(context);
  }

  /**
   * 添加规则
   */
  addRule(rule: VerificationRule): void {
    this.rules.push(rule);
  }

  /**
   * 移除规则
   */
  removeRule(ruleId: string): void {
    this.rules = this.rules.filter(r => r.id !== ruleId);
  }

  /**
   * 获取规则列表
   */
  getRules(): VerificationRule[] {
    return [...this.rules];
  }
}
