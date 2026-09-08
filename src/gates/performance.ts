/**
 * 性能门禁
 *
 * 检查性能指标（架构评审候选2：只留有真实现的维度）：
 * - 测试覆盖率（json-summary）
 * - 打包大小（dist 目录测量）
 *
 * 响应时间/内存使用/吞吐量维度已删除：原实现用 Math.random() 伪造指标并据此判负，
 * runBenchmark 的真实现从未被 check() 调用且语义可疑（量的是 harness 进程自己的
 * heap）——零真实消费者的维度按 ADR-0015 同构判例删薄（ADR-0018）。
 *
 * 改进：
 * - 添加超时机制
 * - 改进错误处理
 * - 返回详细的错误信息
 */

import { execAsync } from '../utils/exec';
import * as fs from 'fs/promises';
import * as path from 'path';
import { pass, gateResult, fromError } from './types';
import type { GateResult, GateContext, PerformanceGateConfig, PerformanceThresholds, Gate, GateDecision } from './types';
import { decisionFromResult } from './decision';

// 默认超时时间（毫秒）
const DEFAULT_TIMEOUTS = {
  coverage: 120000,  // 覆盖率测试：2分钟
};

/**
 * 性能门禁配置
 */
export interface ExtendedPerformanceGateConfig extends PerformanceGateConfig {
  /** 覆盖率测试超时（毫秒） */
  coverageTimeout?: number;
}

/**
 * 性能门禁
 */
export class PerformanceGate implements Gate {
  readonly id = 'performance';
  order = 0;
  private config: Required<ExtendedPerformanceGateConfig>;

  constructor(config: Partial<ExtendedPerformanceGateConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      thresholds: config.thresholds ?? {},
      coverageTimeout: config.coverageTimeout ?? DEFAULT_TIMEOUTS.coverage,
    };
  }

  /**
   * 统一门禁接口（G1）：执行细节私有，决策三态由 check() 报告推导
   */
  async evaluate(context: GateContext): Promise<GateDecision> {
    return decisionFromResult(await this.check(context));
  }

  /**
   * 检查性能
   */
  async check(context: GateContext): Promise<GateResult> {
    const startTime = Date.now();

    if (!this.config.enabled) {
      return pass('performance', '性能门禁已禁用', startTime);
    }

    try {
      const thresholds = context.performanceThresholds ?? this.config.thresholds;
      const metrics = await this.collectMetrics(context.projectPath, thresholds);
      const failures: string[] = [];
      const warnings: string[] = [];

      // 检查覆盖率
      if (thresholds.minCoverage) {
        if (metrics.coverageError) {
          warnings.push(`覆盖率检查失败: ${metrics.coverageError}`);
        } else if (metrics.coverage !== undefined && metrics.coverage < thresholds.minCoverage) {
          failures.push(`覆盖率 ${metrics.coverage}% < ${thresholds.minCoverage}%`);
        }
      }

      // 检查打包大小
      if (thresholds.maxBundleSize) {
        if (metrics.bundleSizeError) {
          warnings.push(`打包大小检查失败: ${metrics.bundleSizeError}`);
        } else if (metrics.bundleSize !== undefined && metrics.bundleSize > thresholds.maxBundleSize) {
          failures.push(`打包大小 ${metrics.bundleSize}KB > ${thresholds.maxBundleSize}KB`);
        }
      }

      const passed = failures.length === 0;
      const message = passed
        ? `性能检查通过: ${this.formatMetrics(metrics)}`
        : failures.join('; ');

      return gateResult(
        'performance',
        passed,
        warnings.length > 0 ? `${message} (警告: ${warnings.join('; ')})` : message,
        startTime,
        {
          metrics: {
            coverage: metrics.coverage,
            bundleSize: metrics.bundleSize,
          },
          thresholds,
          failures,
          warnings,
        }
      );
    } catch (error: any) {
      return fromError('performance', '性能检查失败', error, startTime);
    }
  }

  /**
   * 收集性能指标
   */
  private async collectMetrics(
    projectPath: string,
    thresholds: PerformanceThresholds
  ): Promise<{
    coverage?: number;
    coverageError?: string;
    bundleSize?: number;
    bundleSizeError?: string;
  }> {
    const metrics: any = {};

    // 收集覆盖率（带超时）
    if (thresholds.minCoverage) {
      const result = await this.collectCoverage(projectPath);
      if (result.error) {
        metrics.coverageError = result.error;
      } else {
        metrics.coverage = result.coverage;
      }
    }

    // 收集打包大小
    if (thresholds.maxBundleSize) {
      const result = await this.collectBundleSize(projectPath);
      if (result.error) {
        metrics.bundleSizeError = result.error;
      } else {
        metrics.bundleSize = result.bundleSize;
      }
    }

    return metrics;
  }

  /**
   * 收集测试覆盖率（带超时）
   */
  private async collectCoverage(projectPath: string): Promise<{
    coverage?: number;
    error?: string;
  }> {
    try {
      // 使用超时执行覆盖率测试
      await execAsync(
        'npm test -- --coverage --coverageReporters=json-summary 2>/dev/null || true',
        {
          cwd: projectPath,
          maxBuffer: 10 * 1024 * 1024,
          timeout: this.config.coverageTimeout,
          killSignal: 'SIGTERM',
        }
      );

      // 读取覆盖率报告
      const coveragePath = path.join(projectPath, 'coverage', 'coverage-summary.json');
      const content = await fs.readFile(coveragePath, 'utf-8');
      const coverage = JSON.parse(content);

      return { coverage: coverage.total?.lines?.pct || 0 };
    } catch (error: any) {
      // 区分超时和其他错误
      if (error.killed) {
        return { error: `覆盖率测试超时 (${this.config.coverageTimeout}ms)` };
      }
      if (error.code === 'ENOENT') {
        return { error: '未找到覆盖率报告文件' };
      }
      return { error: error.message || '覆盖率测试失败' };
    }
  }

  /**
   * 收集打包大小
   */
  private async collectBundleSize(projectPath: string): Promise<{
    bundleSize?: number;
    error?: string;
  }> {
    try {
      const distPath = path.join(projectPath, 'dist');
      const files = await fs.readdir(distPath);
      let totalSize = 0;

      for (const file of files) {
        const filePath = path.join(distPath, file);
        const stat = await fs.stat(filePath);
        if (stat.isFile()) {
          totalSize += stat.size;
        }
      }

      return { bundleSize: Math.round(totalSize / 1024) };
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return { error: '未找到 dist 目录' };
      }
      return { error: error.message || '打包大小检查失败' };
    }
  }

  /**
   * 格式化指标输出
   */
  private formatMetrics(metrics: any): string {
    const parts: string[] = [];
    if (metrics.coverage !== undefined) parts.push(`覆盖率=${metrics.coverage}%`);
    if (metrics.bundleSize !== undefined) parts.push(`打包=${metrics.bundleSize}KB`);
    return parts.join(', ') || '无指标';
  }

  /**
   * 设置阈值
   */
  setThresholds(thresholds: Partial<PerformanceThresholds>): void {
    this.config.thresholds = { ...this.config.thresholds, ...thresholds };
  }

  /**
   * 设置超时时间
   */
  setTimeouts(options: {
    coverage?: number;
  }): void {
    if (options.coverage) this.config.coverageTimeout = options.coverage;
  }

  /**
   * 获取配置
   */
  getConfig(): Required<ExtendedPerformanceGateConfig> {
    return { ...this.config };
  }
}
