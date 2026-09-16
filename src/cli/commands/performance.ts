/**
 * harness performance 命令
 *
 * 性能门控，检查性能指标
 */

import chalk from 'chalk';
import { PerformanceGate, type ExtendedPerformanceGateConfig } from '../../gates/performance';
import type { PerformanceThresholds } from '../../gates/types';
import { log, processIO, type CommandIO, type CommandResult } from '../command-contract';
import { reportGateDecision, reportGateError } from '../gate-command';

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

  // 构建配置（架构评审候选2：键名对齐 PerformanceThresholds 真字段——
  // 原 thresholds.coverage / bundleSize 字节换算是错位键，旗帜恒不生效）
  const config: Partial<ExtendedPerformanceGateConfig> = {};
  const thresholds: PerformanceThresholds = {};

  if (options.coverage && options.coverageThreshold) {
    thresholds.minCoverage = options.coverageThreshold;
  }

  if (options.bundleThreshold) {
    thresholds.maxBundleSize = options.bundleThreshold; // KB 直传，gate 按 KB 比较
  }

  if (Object.keys(thresholds).length > 0) {
    config.thresholds = thresholds;
  }

  // 创建性能门控实例
  const gate = new PerformanceGate(config);

  try {
    const decision = await gate.evaluate({ projectPath });

    return reportGateDecision(
      io,
      {
        gateId: 'performance',
        label: '性能门控',
        onPass: (r) => {
          if (!r.details?.metrics) return [];
          const metrics = r.details.metrics as any;
          const lines = ['', chalk.gray('性能指标:')];

          if (metrics.coverage !== undefined) {
            const threshold = options.coverageThreshold || 80;
            lines.push(chalk.gray(`  覆盖率: ${metrics.coverage.toFixed(2)}% ${metrics.coverage >= threshold ? '✅' : '❌'}`));
          }

          if (metrics.bundleSize !== undefined) {
            const thresholdKB = options.bundleThreshold || 500;
            lines.push(chalk.gray(`  打包大小: ${metrics.bundleSize} KB ${metrics.bundleSize <= thresholdKB ? '✅' : '❌'}`));
          }

          return lines;
        },
        onFail: (r) =>
          r.details?.failures
            ? (r.details.failures as string[]).map((failure: string) => chalk.red(`   - ${failure}`))
            : [],
      },
      decision
    );
  } catch (error) {
    return reportGateError(io, 'performance', '性能门控', error);
  }
}
