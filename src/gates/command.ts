/**
 * 命令门禁 - Command Gate
 * SEC-006: 命令黑名单
 *
 * 检查命令是否安全，防止执行危险操作
 */

import { gateResult } from './types';
import type { GateResult, CommandGateConfig, CommandBlacklistRule, Gate, GateContext, GateDecision } from './types';
import { decisionFromResult } from './decision';
import { DEFAULT_COMMAND_BLACKLIST } from './blacklist-rules';

/**
 * 黑名单级别（正本在 src/types/gate.ts，与 CommandBlacklistRule.level 同一定义）
 */
export type { BlacklistLevel } from './types';

// 规则表正本 ./blacklist-rules.ts（班次 3 Phase 4 拆出，re-export 保既有进口）
export { DEFAULT_COMMAND_BLACKLIST } from './blacklist-rules';

/**
 * 三投影共用的裁决（模块内类型，不入公共面）
 */
interface CommandVerdict {
  allowed: boolean;
  blocked: CommandBlacklistRule[];
  warnings: CommandBlacklistRule[];
  audits: CommandBlacklistRule[];
  riskLevel: 'high' | 'medium' | 'low';
}

/**
 * 命令门禁
 */
export class CommandGate implements Gate {
  readonly id = 'command';
  order = 0;
  private config: Required<CommandGateConfig>;
  private blacklist: CommandBlacklistRule[];

  constructor(config: Partial<CommandGateConfig> = {}) {
    this.config = {
      ignoreCategories: config.ignoreCategories ?? [],
    };

    this.blacklist = [...DEFAULT_COMMAND_BLACKLIST];
  }

  /**
   * 统一门禁接口（G1）：执行细节私有，决策三态由 check() 报告推导。
   * 待检命令经 GateContext.command 传入。
   */
  async evaluate(context: GateContext): Promise<GateDecision> {
    return decisionFromResult(await this.check(context.command ?? ''));
  }

  /**
   * 检查命令
   */
  async check(command: string): Promise<GateResult> {
    const startTime = Date.now();

    const verdict = this.judge(command);

    return gateResult(
      'command',
      verdict.allowed,
      verdict.allowed
        ? this.formatSuccessMessage(verdict)
        : this.formatBlockMessage(verdict),
      startTime,
      {
        blocked: verdict.blocked,
        warnings: verdict.warnings,
        audits: verdict.audits,
        command,
      }
    );
  }

  /**
   * 唯一匹配谓词（#135）：类别忽略与规则模式测试只在此处发生。
   * 三个入口一律经 judge() 取它的投影，不再各写一遍匹配循环。
   *
   * P1-7（ADR-0031，票08）起由私有提为公共同步只读面：
   * pretool-use-hook 需要命中明细（rule id/level）写审计 trace，
   * isAllowed 的布尔投影丢掉了 hits。谓词语义不变，调用方不得改返回数组。
   */
  match(command: string): CommandBlacklistRule[] {
    const hits: CommandBlacklistRule[] = [];

    for (const rule of this.blacklist) {
      // 跳过忽略的类别
      if (this.config.ignoreCategories.includes(rule.category)) {
        continue;
      }

      if (rule.pattern.test(command)) {
        hits.push(rule);
      }
    }

    return hits;
  }

  /**
   * 命中集合 → 裁决：级别（block/warn/audit）语义只在此处解释一次，
   * 三投影因此对同一输入不可能互相矛盾。
   */
  private judge(command: string): CommandVerdict {
    const hits = this.match(command);
    const blocked = hits.filter(rule => rule.level === 'block');
    const warnings = hits.filter(rule => rule.level === 'warn');
    const audits = hits.filter(rule => rule.level === 'audit');

    let riskLevel: 'high' | 'medium' | 'low' = 'low';
    if (blocked.length > 0) {
      riskLevel = 'high';
    } else if (warnings.length > 0) {
      riskLevel = 'medium';
    }

    return {
      allowed: blocked.length === 0,
      blocked,
      warnings,
      audits,
      riskLevel,
    };
  }

  /**
   * 格式化成功消息
   */
  private formatSuccessMessage(result: {
    warnings: CommandBlacklistRule[];
    audits: CommandBlacklistRule[];
  }): string {
    const parts: string[] = ['命令检查通过'];

    if (result.warnings.length > 0) {
      parts.push(`，${result.warnings.length} 个警告`);
    }

    if (result.audits.length > 0) {
      parts.push(`，${result.audits.length} 个审计记录`);
    }

    return parts.join('');
  }

  /**
   * 格式化阻止消息
   */
  private formatBlockMessage(result: {
    blocked: CommandBlacklistRule[];
    warnings: CommandBlacklistRule[];
    audits: CommandBlacklistRule[];
  }): string {
    const lines: string[] = [];

    lines.push('命令被禁止执行：');
    for (const rule of result.blocked) {
      lines.push(`  - [${rule.id}] ${rule.message} (${rule.category})`);
    }

    return lines.join('\n');
  }

  /**
   * 快速检查（不生成完整 GateResult）——谓词裁决的布尔投影，hook 侧入口
   */
  isAllowed(command: string): boolean {
    return this.judge(command).allowed;
  }

  /**
   * 获取命令风险等级——谓词裁决的等级投影：命中集合里的最高档
   */
  getRiskLevel(command: string): 'high' | 'medium' | 'low' {
    return this.judge(command).riskLevel;
  }
}

// ========== 便捷函数 ==========

/**
 * 创建命令门禁
 */
export function createCommandGate(config?: Partial<CommandGateConfig>): CommandGate {
  return new CommandGate(config);
}
