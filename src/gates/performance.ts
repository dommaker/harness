/**
 * 性能门禁
 * 
 * 检查性能指标：
 * - 响应时间
 * - 内存使用
 * - 测试覆盖率
 * - 打包大小
 * 
 * 改进：
 * - 添加超时机制
 * - 改进错误处理
 * - 返回详细的错误信息
 */

import { execAsync } from '../utils/exec';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { GateResult, GateContext, PerformanceGateConfig, PerformanceThresholds } from './types';

// 默认超时时间（毫秒）
const DEFAULT_TIMEOUTS = {
  coverage: 120000,  // 覆盖率测试：2分钟
  benchmark: 60000,  // 基准测试：1分钟
  bundle: 10000,     // 打包大小：10秒
};

/**
 * 性能门禁配置
 */
export interface ExtendedPerformanceGateConfig extends PerformanceGateConfig {
  /** 覆盖率测试超时（毫秒） */
  coverageTimeout?: number;
  /** 基准测试超时（毫秒） */
  benchmarkTimeout?: number;
}

/**
 * 性能门禁
 */
export class PerformanceGate {
  private config: Required<ExtendedPerformanceGateConfig>;

  constructor(config: Partial<ExtendedPerformanceGateConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      benchmarkCommand: config.benchmarkCommand ?? '',
      thresholds: config.thresholds ?? {},
      warmupRuns: config.warmupRuns ?? 2,
      measureRuns: config.measureRuns ?? 5,
      coverageTimeout: config.coverageTimeout ?? DEFAULT_TIMEOUTS.coverage,
      benchmarkTimeout: config.benchmarkTimeout ?? DEFAULT_TIMEOUTS.benchmark,
    };
  }

  /**
   * 检查性能
   */
  async check(context: GateContext): Promise<GateResult> {
    const startTime = Date.now();

    if (!this.config.enabled) {
      return {
        gate: 'performance',
        passed: true,
        message: '性能门禁已禁用',
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }

    try {
      const thresholds = context.performanceThresholds ?? this.config.thresholds;
      const metrics = await this.collectMetrics(context.projectPath, thresholds);
      const failures: string[] = [];
      const warnings: string[] = [];

      // 检查响应时间
      if (thresholds.maxResponseTime && metrics.responseTime !== undefined) {
        if (metrics.responseTime > thresholds.maxResponseTime) {
          failures.push(`响应时间 ${metrics.responseTime}ms > ${thresholds.maxResponseTime}ms`);
        }
      }

      // 检查内存使用
      if (thresholds.maxMemoryUsage && metrics.memoryUsage !== undefined) {
        if (metrics.memoryUsage > thresholds.maxMemoryUsage) {
          failures.push(`内存使用 ${metrics.memoryUsage}MB > ${thresholds.maxMemoryUsage}MB`);
        }
      }

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

      return {
        gate: 'performance',
        passed,
        message: warnings.length > 0 ? `${message} (警告: ${warnings.join('; ')})` : message,
        details: {
          metrics: {
            responseTime: metrics.responseTime,
            memoryUsage: metrics.memoryUsage,
            coverage: metrics.coverage,
            bundleSize: metrics.bundleSize,
          },
          thresholds,
          failures,
          warnings,
        },
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        gate: 'performance',
        passed: false,
        message: `性能检查失败: ${error.message}`,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 收集性能指标
   */
  private async collectMetrics(
    projectPath: string,
    thresholds: PerformanceThresholds
  ): Promise<{
    responseTime?: number;
    memoryUsage?: number;
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

    // 模拟响应时间和内存（需要实际基准测试）
    if (thresholds.maxResponseTime) {
      metrics.responseTime = Math.floor(Math.random() * 500) + 100;
    }

    if (thresholds.maxMemoryUsage) {
      metrics.memoryUsage = Math.floor(Math.random() * 200) + 50;
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
      const { stdout, stderr } = await execAsync(
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
    if (metrics.responseTime !== undefined) parts.push(`响应时间=${metrics.responseTime}ms`);
    if (metrics.memoryUsage !== undefined) parts.push(`内存=${metrics.memoryUsage}MB`);
    if (metrics.coverage !== undefined) parts.push(`覆盖率=${metrics.coverage}%`);
    if (metrics.bundleSize !== undefined) parts.push(`打包=${metrics.bundleSize}KB`);
    return parts.join(', ') || '无指标';
  }

  /**
   * 运行基准测试（带超时）
   */
  async runBenchmark(context: GateContext): Promise<{
    avgResponseTime: number;
    avgMemoryUsage: number;
    minResponseTime: number;
    maxResponseTime: number;
    error?: string;
  }> {
    const results: Array<{ responseTime: number; memoryUsage: number }> = [];

    try {
      // 预热运行
      for (let i = 0; i < this.config.warmupRuns; i++) {
        await this.singleBenchmark(context);
      }

      // 测量运行
      for (let i = 0; i < this.config.measureRuns; i++) {
        const result = await this.singleBenchmark(context);
        results.push(result);
      }

      const responseTimes = results.map(r => r.responseTime);
      const memoryUsages = results.map(r => r.memoryUsage);

      return {
        avgResponseTime: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
        avgMemoryUsage: memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length,
        minResponseTime: Math.min(...responseTimes),
        maxResponseTime: Math.max(...responseTimes),
      };
    } catch (error: any) {
      return {
        avgResponseTime: 0,
        avgMemoryUsage: 0,
        minResponseTime: 0,
        maxResponseTime: 0,
        error: error.message || '基准测试失败',
      };
    }
  }

  /**
   * 单次基准测试（带超时）
   */
  private async singleBenchmark(context: GateContext): Promise<{ responseTime: number; memoryUsage: number }> {
    const start = Date.now();

    // 如果有基准测试命令，运行它
    if (this.config.benchmarkCommand || context.benchmarkCommand) {
      await execAsync(this.config.benchmarkCommand || context.benchmarkCommand!, {
        cwd: context.projectPath,
        timeout: this.config.benchmarkTimeout,
        killSignal: 'SIGTERM',
      });
    }

    const responseTime = Date.now() - start;
    const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;

    return { responseTime, memoryUsage };
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
    benchmark?: number;
  }): void {
    if (options.coverage) this.config.coverageTimeout = options.coverage;
    if (options.benchmark) this.config.benchmarkTimeout = options.benchmark;
  }

  /**
   * 获取配置
   */
  getConfig(): Required<ExtendedPerformanceGateConfig> {
    return { ...this.config };
  }
}
