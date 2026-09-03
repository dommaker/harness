/**
 * 命令黑名单检查
 *
 * 用法：
 *   harness command "rm -rf /"
 *   harness command --level "DROP TABLE users"
 *   harness command --list
 *
 * 判定经返回值外溢（架构评审候选7）：风险等级/黑名单裁决译成 kind，
 * 退出码映射收敛在 bin 一处。
 */

import { createCommandGate, getCommandRiskLevel, DEFAULT_COMMAND_BLACKLIST, type CommandBlacklistRule } from '../../gates';
import { log, logError, processIO, type CommandIO, type CommandResult } from '../command-contract';

export interface CommandCheckOptions {
  level?: boolean;
  list?: boolean;
  json?: boolean;
  strict?: boolean;
}

/**
 * 执行命令黑名单检查（供 bin/harness.js 调用）
 */
export async function executeCommand(
  cmd: string | undefined,
  options: CommandCheckOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  if (options.list) {
    if (options.json) {
      log(io, JSON.stringify(DEFAULT_COMMAND_BLACKLIST.map((r: CommandBlacklistRule) => ({
        id: r.id,
        level: r.level,
        message: r.message,
        category: r.category,
      })), null, 2));
    } else {
      log(io, '\n命令黑名单规则：\n');

      const byCategory = DEFAULT_COMMAND_BLACKLIST.reduce((acc: Record<string, CommandBlacklistRule[]>, rule: CommandBlacklistRule) => {
        if (!acc[rule.category]) acc[rule.category] = [];
        acc[rule.category].push(rule);
        return acc;
      }, {});

      for (const [category, rules] of Object.entries(byCategory)) {
        log(io, `[${category}]`);
        for (const rule of rules as CommandBlacklistRule[]) {
          const levelIcon = rule.level === 'block' ? '🚫' : rule.level === 'warn' ? '⚠️' : '📋';
          log(io, `  ${levelIcon} ${rule.id}: ${rule.message} (${rule.level})`);
        }
        log(io);
      }

      log(io, `共 ${DEFAULT_COMMAND_BLACKLIST.length} 条规则`);
    }
    return { kind: 'ok' };
  }

  if (!cmd) {
    logError(io, '错误：请提供要检查的命令');
    logError(io, '用法：harness command "your command"');
    return { kind: 'usage-error', reason: '缺少要检查的命令参数' };
  }

  const gate = createCommandGate({ strict: options.strict });
  const result = await gate.check(cmd);

  if (options.level) {
    const level = getCommandRiskLevel(cmd);
    if (options.json) {
      log(io, JSON.stringify({ level, command: cmd }));
    } else {
      const levelColors: Record<string, string> = {
        high: '\x1b[31m',
        medium: '\x1b[33m',
        low: '\x1b[32m',
      };
      log(io, `${levelColors[level]}${level}\x1b[0m ${cmd}`);
    }
    // 严重级闸门（历史条件式）：high → 非零退出
    return level === 'high'
      ? { kind: 'fail', reason: `command risk level is high: ${cmd}` }
      : { kind: 'ok' };
  }

  if (options.json) {
    log(io, JSON.stringify({
      command: cmd,
      passed: result.passed,
      message: result.message,
      details: result.details,
    }, null, 2));
  } else {
    log(io, result.passed ? `\x1b[32m✓\x1b[0m ${result.message}` : `\x1b[31m✗\x1b[0m ${result.message}`);
  }

  return result.passed
    ? { kind: 'ok' }
    : { kind: 'fail', reason: `command gate denied: ${result.message}` };
}
