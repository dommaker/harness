/**
 * harness passes-gate 命令
 * 
 * 运行测试门控，确保测试通过
 */

import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execAsync } from '../../utils/exec';
import { PassesGate, detectTestCommand } from '../../core/validators/passes-gate';
import type { PassesGateConfig } from '../../types/passes-gate';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';

export interface PassesGateOptions {
  /** 测试命令 */
  testCommand?: string;
  /** 项目路径 */
  projectPath?: string;
  /** 是否允许部分通过 */
  allowPartial?: boolean;
  /** 最大重试次数 */
  maxRetries?: number;
}

/**
 * 执行测试门控
 */
export async function runPassesGate(
  options: PassesGateOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  log(io, chalk.blue('🚦 运行测试门控...'));

  const projectPath = options.projectPath || process.cwd();

  // 检测测试命令
  let testCommand = options.testCommand;
  if (!testCommand) {
    testCommand = await detectTestCommand(projectPath);
  }

  if (!testCommand) {
    log(io, chalk.yellow('⚠️  未检测到测试命令，跳过测试门控'));
    log(io, chalk.gray('提示: 使用 --test-command 指定测试命令'));
    return { kind: 'skip', reason: '未检测到测试命令' };
  }

  log(io, chalk.gray(`测试命令: ${testCommand}`));

  // 配置
  const config: PassesGateConfig = {
    enabled: true,
    testCommand,
    requireEvidence: false,
    allowPartialPass: options.allowPartial || false,
    maxRetries: options.maxRetries || 2,
  };

  // 执行测试
  const passesGate = new PassesGate(config);

  try {
    const result = await passesGate.runTests(projectPath);

    log(io);
    log(io, chalk.gray('测试结果:'));
    log(io, chalk.gray(`  通过: ${result.passedTests}/${result.totalTests}`));
    log(io, chalk.gray(`  失败: ${result.failedTests}/${result.totalTests}`));
    log(io, chalk.gray(`  耗时: ${result.duration}ms`));

    if (result.passed) {
      log(io);
      log(io, chalk.green('✅ 测试门控通过'));
      log(io, chalk.green('   task.passes = true (由测试结果设置)'));
    } else {
      log(io);
      log(io, chalk.red('❌ 测试门控未通过'));
      log(io, chalk.red('   task.passes = false'));
      
      if (result.failures && result.failures.length > 0) {
        log(io, chalk.red('\n失败的测试:'));
        result.failures.forEach(f => {
          log(io, chalk.red(`  - ${f.name}: ${f.message}`));
        });
      }

      return { kind: 'fail', reason: `passes-gate denied: ${result.failedTests}/${result.totalTests} 个测试失败` };
    }
    return { kind: 'ok' };
  } catch (error) {
    log(io, chalk.red(`\n❌ 测试执行失败: ${(error as Error).message}`));
    return { kind: 'fail', reason: `passes-gate 测试执行异常: ${(error as Error).message}` };
  }
}

/**
 * --coverage 路由入口（候选7）：projectPath 兜底 + 阈值强转编组，
 * 自 definitions.ts 的 optionRoutes args 闭包移回命令模块。
 */
export async function coverageCheck(
  options: Record<string, unknown>,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  return checkCoverage(
    (options.projectPath as string) || process.cwd(),
    parseInt(String(options.coverageThreshold), 10),
    io,
  );
}

/**
 * 检查测试覆盖率
 */
export async function checkCoverage(
  projectPath: string,
  threshold: number = 80,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  log(io, chalk.blue(`📊 检查测试覆盖率 (阈值: ${threshold}%)...`));

  try {
    // 运行覆盖率检查
    await execAsync('npm test -- --coverage --coverageReporters=json-summary', {
      cwd: projectPath,
    });

    // 读取覆盖率报告
    const coveragePath = path.join(projectPath, 'coverage', 'coverage-summary.json');
    const content = await fs.readFile(coveragePath, 'utf-8');
    const coverage = JSON.parse(content);

    const totalCoverage = coverage.total?.lines?.pct || 0;

    log(io, chalk.gray(`当前覆盖率: ${totalCoverage}%`));

    if (totalCoverage >= threshold) {
      log(io, chalk.green(`✅ 覆盖率达标 (${totalCoverage}% >= ${threshold}%)`));
      return { kind: 'ok' };
    }
    log(io, chalk.red(`❌ 覆盖率不足 (${totalCoverage}% < ${threshold}%)`));
    // 历史行为：--coverage 路由的未达标不改退出码（今日返回值被 bin 丢弃）→ skip 保留 0 面
    return { kind: 'skip', reason: `覆盖率不足: ${totalCoverage}% < ${threshold}%` };
  } catch (error) {
    log(io, chalk.yellow(`⚠️  无法获取覆盖率信息: ${(error as Error).message}`));
    return { kind: 'skip', reason: `无法获取覆盖率信息: ${(error as Error).message}` }; // 无法获取时跳过检查
  }
}
