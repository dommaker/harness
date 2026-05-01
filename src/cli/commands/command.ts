/**
 * 命令黑名单检查
 *
 * 用法：
 *   harness command "rm -rf /"
 *   harness command --level "DROP TABLE users"
 *   harness command --list
 */

import { createCommandGate, getCommandRiskLevel, DEFAULT_COMMAND_BLACKLIST, type CommandBlacklistRule } from '../../gates';

export interface CommandCheckOptions {
  level?: boolean;
  list?: boolean;
  json?: boolean;
  strict?: boolean;
}

/**
 * 执行命令黑名单检查（供 bin/harness.js 调用）
 */
export async function executeCommand(cmd: string | undefined, options: CommandCheckOptions): Promise<void> {
  if (options.list) {
    if (options.json) {
      console.log(JSON.stringify(DEFAULT_COMMAND_BLACKLIST.map((r: CommandBlacklistRule) => ({
        id: r.id,
        level: r.level,
        message: r.message,
        category: r.category,
      })), null, 2));
    } else {
      console.log('\n命令黑名单规则：\n');

      const byCategory = DEFAULT_COMMAND_BLACKLIST.reduce((acc: Record<string, CommandBlacklistRule[]>, rule: CommandBlacklistRule) => {
        if (!acc[rule.category]) acc[rule.category] = [];
        acc[rule.category].push(rule);
        return acc;
      }, {});

      for (const [category, rules] of Object.entries(byCategory)) {
        console.log(`[${category}]`);
        for (const rule of rules as CommandBlacklistRule[]) {
          const levelIcon = rule.level === 'block' ? '🚫' : rule.level === 'warn' ? '⚠️' : '📋';
          console.log(`  ${levelIcon} ${rule.id}: ${rule.message} (${rule.level})`);
        }
        console.log();
      }

      console.log(`共 ${DEFAULT_COMMAND_BLACKLIST.length} 条规则`);
    }
    return;
  }

  if (!cmd) {
    console.error('错误：请提供要检查的命令');
    console.error('用法：harness command "your command"');
    process.exit(1);
  }

  const gate = createCommandGate({ strict: options.strict });
  const result = await gate.check(cmd);

  if (options.level) {
    const level = getCommandRiskLevel(cmd);
    if (options.json) {
      console.log(JSON.stringify({ level, command: cmd }));
    } else {
      const levelColors: Record<string, string> = {
        high: '\x1b[31m',
        medium: '\x1b[33m',
        low: '\x1b[32m',
      };
      console.log(`${levelColors[level]}${level}\x1b[0m ${cmd}`);
    }
    process.exit(level === 'high' ? 1 : 0);
  }

  if (options.json) {
    console.log(JSON.stringify({
      command: cmd,
      passed: result.passed,
      message: result.message,
      details: result.details,
    }, null, 2));
  } else {
    console.log(result.passed ? `\x1b[32m✓\x1b[0m ${result.message}` : `\x1b[31m✗\x1b[0m ${result.message}`);
  }

  process.exit(result.passed ? 0 : 1);
}
