/**
 * harness performance 命令
 *
 * 性能门控，检查性能指标
 */

import chalk from 'chalk';
import { PerformanceGate } from '../../gates/performance';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';

export interface PerformanceOptions {
  /** 项目路径 */
  projectPath?: string;
  /** 是否检查覆盖率 */
  coverage?: boolean;
  /** 覆盖率阈值 */
  coverageThreshold?: number;
  /** 是否检查打包大小 */
  bundle?: boolean;
  /** 打包大小阈值（KB） */
  bundleThreshold?: number;
  /** 是否检查基准测试 */
  benchmark?: boolean;
  /** 基准测试超时（秒） */
  benchmarkTimeout?: number;
}

/**
 * 执行性能门控
 */
export async function performance(
  options: PerformanceOptions,
  io: CommandIO = processIO,
): Promise<CommandResult> {
  log(io, chalk.blue('⚡ 性能门控检查...'));

  const projectPath = options.projectPath || process.cwd();

  // 构建配置
  const config: any = {};

  if (options.coverage && options.coverageThreshold) {
    config.thresholds = {
      coverage: options.coverageThreshold,
    };
  }

  if (options.bundleThreshold) {
    config.thresholds = config.thresholds || {};
    config.thresholds.bundleSize = options.bundleThreshold * 1024; // KB to bytes
  }

  if (options.benchmarkTimeout) {
    config.benchmarkTimeout = options.benchmarkTimeout * 1000; // seconds to ms
  }

  // 创建性能门控实例
  const gate = new PerformanceGate(config);

  try {
    const result = await gate.check({
      projectPath,
      checkCoverage: options.coverage,
      checkBundle: options.bundle,
      checkBenchmark: options.benchmark,
    } as any);

    if (result.passed) {
      log(io);
      log(io, chalk.green('✅ 性能门控检查通过'));

      // 显示详细指标
      if (result.details?.metrics) {
        log(io);
        log(io, chalk.gray('性能指标:'));

        const metrics = result.details.metrics as any;
        if (metrics.coverage !== undefined) {
          const threshold = options.coverageThreshold || 80;
          const status = metrics.coverage >= threshold ? '✅' : '❌';
          log(io, chalk.gray(`  覆盖率: ${metrics.coverage.toFixed(2)}% ${status}`));
        }

        if (metrics.bundleSize !== undefined) {
          const thresholdKB = options.bundleThreshold || 500;
          const actualKB = metrics.bundleSize / 1024;
          const status = actualKB <= thresholdKB ? '✅' : '❌';
          log(io, chalk.gray(`  打包大小: ${actualKB.toFixed(2)} KB ${status}`));
        }

        if (metrics.benchmarkTime !== undefined) {
          log(io, chalk.gray(`  基准测试: ${metrics.benchmarkTime}ms`));
        }
      }
    } else {
      log(io);
      log(io, chalk.red('❌ 性能门控检查失败'));
      log(io, chalk.red(`   ${result.message}`));
      if (result.details?.failures) {
        (result.details.failures as string[]).forEach((failure: string) => {
          log(io, chalk.red(`   - ${failure}`));
        });
      }
      return { kind: 'fail', reason: `performance gate denied: ${result.message}` };
    }
    return { kind: 'ok' };
  } catch (error: any) {
    log(io);
    log(io, chalk.red('❌ 性能门控检查出错'));
    log(io, chalk.red(`   ${error.message}`));
    return { kind: 'fail', reason: `performance gate error: ${error.message}` };
  }
}
