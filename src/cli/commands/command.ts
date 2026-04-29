/**
 * 命令黑名单检查
 * 
 * 用法：
 *   harness command "rm -rf /"
 *   harness command --level "DROP TABLE users"
 *   harness command --list
 */

import { Command } from 'commander';
import { createCommandGate, getCommandRiskLevel, DEFAULT_COMMAND_BLACKLIST, type CommandBlacklistRule } from '../../gates';

export const command = new Command('command')
  .description('检查命令是否在黑名单中')
  .argument('[cmd]', '要检查的命令')
  .option('-l, --level', '显示风险等级')
  .option('--list', '列出所有黑名单规则')
  .option('--json', 'JSON 格式输出')
  .option('--strict', '严格模式（warn 也阻止）')
  .action(async (cmd: string | undefined, options: { level?: boolean; list?: boolean; json?: boolean; strict?: boolean }) => {
    // 列出所有规则
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
    
    // 需要命令参数
    if (!cmd) {
      console.error('错误：请提供要检查的命令');
      console.error('用法：harness command "your command"');
      process.exit(1);
    }
    
    // 创建门禁
    const gate = createCommandGate({ strict: options.strict });
    const result = await gate.check(cmd);
    
    if (options.level) {
      // 只显示风险等级
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
    
    // 完整检查
    if (options.json) {
      console.log(JSON.stringify({
        command: cmd,
        passed: result.passed,
        message: result.message,
        details: result.details,
      }, null, 2));
    } else {
      if (result.passed) {
        console.log(`\x1b[32m✓\x1b[0m ${result.message}`);
      } else {
        console.log(`\x1b[31m✗\x1b[0m ${result.message}`);
      }
    }
    
    process.exit(result.passed ? 0 : 1);
  });

// 别名
export const cmd = new Command('cmd')
  .description('命令黑名单检查（command 的别名）')
  .argument('[cmd]', '要检查的命令')
  .option('-l, --level', '显示风险等级')
  .option('--list', '列出所有黑名单规则')
  .option('--json', 'JSON 格式输出')
  .option('--strict', '严格模式（warn 也阻止）')
  .action(async (cmd: string | undefined, options: { level?: boolean; list?: boolean; json?: boolean; strict?: boolean }) => {
    // 复用 command 的逻辑
    const gate = createCommandGate({ strict: options.strict });
    
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
        console.log(`共 ${DEFAULT_COMMAND_BLACKLIST.length} 条规则`);
        console.log('使用 harness command --list 查看详情');
      }
      return;
    }
    
    if (!cmd) {
      console.error('错误：请提供要检查的命令');
      process.exit(1);
    }
    
    const result = await gate.check(cmd);
    
    if (options.level) {
      const level = getCommandRiskLevel(cmd);
      console.log(level);
      process.exit(level === 'high' ? 1 : 0);
    }
    
    if (options.json) {
      console.log(JSON.stringify({
        command: cmd,
        passed: result.passed,
        message: result.message,
      }, null, 2));
    } else {
      console.log(result.passed ? `\x1b[32m✓\x1b[0m` : `\x1b[31m✗\x1b[0m ${result.message}`);
    }
    
    process.exit(result.passed ? 0 : 1);
  });
