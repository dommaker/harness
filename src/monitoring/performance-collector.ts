/**
 * Performance Collector
 *
 * 轻量设计，零 Token 成本
 *
 * 功能：
 * - 记录操作耗时（追加写入）
 * - 批量读取 traces（按时间范围过滤）
 * - 文件滚动（防止文件过大）
 *
 * 与 TraceCollector 的区别：
 * - TraceCollector: 记录约束检查结果
 * - PerformanceCollector: 记录操作耗时
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  PerformanceTrace,
  PerformanceTraceFilter,
  PerformanceCollectorConfig,
} from '../types/performance';

/**
 * 默认配置
 */
const DEFAULT_CONFIG: PerformanceCollectorConfig = {
  logFile: '.harness/logs/performance.log',
  maxFileSize: 10 * 1024 * 1024, // 10MB
  enabled: true,
};

/**
 * Performance Collector
 *
 * 使用方式：
 * ```typescript
 * const collector = new PerformanceCollector();
 * collector.recordOk('extract', 150);
 * collector.recordExceeded('invokeSkillAgent', 35000, 30000);
 * ```
 */
export class PerformanceCollector {
  private config: PerformanceCollectorConfig;
  private logFile: string;

  constructor(config?: Partial<PerformanceCollectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logFile = this.config.logFile!;
    this.ensureDirectory();
  }

  /**
   * 确保日志目录存在
   */
  private ensureDirectory(): void {
    const dir = path.dirname(this.logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 记录一条性能数据
   *
   * 轻量操作：
   * - 追加写入（不读取现有内容）
   * - 单行 JSON（便于批量处理）
   * - 零 Token 成本
   */
  record(trace: PerformanceTrace): void {
    if (!this.config.enabled) return;

    // 检查文件大小，必要时滚动
    this.checkFileSize();

    // 追加写入
    const line = JSON.stringify(trace);
    fs.appendFileSync(this.logFile, line + '\n', 'utf-8');
  }

  /**
   * 快捷方法：记录正常执行
   */
  recordOk(
    operation: string,
    duration: number,
    metadata?: Record<string, unknown>
  ): void {
    this.record({
      operation,
      timestamp: Date.now(),
      duration,
      result: 'ok',
      metadata,
    });
  }

  /**
   * 快捷方法：记录超阈值
   */
  recordExceeded(
    operation: string,
    duration: number,
    threshold: number,
    metadata?: Record<string, unknown>
  ): void {
    this.record({
      operation,
      timestamp: Date.now(),
      duration,
      result: 'exceeded',
      threshold,
      metadata,
    });
  }

  /**
   * 快捷方法：记录错误
   */
  recordError(
    operation: string,
    duration: number,
    error: Error | string,
    metadata?: Record<string, unknown>
  ): void {
    this.record({
      operation,
      timestamp: Date.now(),
      duration,
      result: 'error',
      metadata: {
        ...metadata,
        error: error instanceof Error ? error.message : error,
      },
    });
  }

  /**
   * 批量读取 traces
   *
   * 支持过滤条件：
   * - 时间范围
   * - 操作类型
   * - 结果类型
   */
  read(filter?: PerformanceTraceFilter): PerformanceTrace[] {
    if (!fs.existsSync(this.logFile)) {
      return [];
    }

    const content = fs.readFileSync(this.logFile, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    let traces = lines.map(line => JSON.parse(line) as PerformanceTrace);

    // 应用过滤条件
    if (filter) {
      traces = this.applyFilter(traces, filter);
    }

    return traces;
  }

  /**
   * 读取最近 N 小时的 traces
   */
  readRecent(hours: number): PerformanceTrace[] {
    const start = Date.now() - hours * 3600 * 1000;
    return this.read({ timeRange: { start, end: Date.now() } });
  }

  /**
   * 读取特定操作的 traces
   */
  readByOperation(operation: string): PerformanceTrace[] {
    return this.read({ operation });
  }

  /**
   * 应用过滤条件
   */
  private applyFilter(traces: PerformanceTrace[], filter: PerformanceTraceFilter): PerformanceTrace[] {
    return traces.filter(trace => {
      // 操作类型
      if (filter.operation && trace.operation !== filter.operation) {
        return false;
      }

      // 结果
      if (filter.result && trace.result !== filter.result) {
        return false;
      }

      // 时间范围
      if (filter.timeRange) {
        if (trace.timestamp < filter.timeRange.start) {
          return false;
        }
        if (filter.timeRange.end && trace.timestamp > filter.timeRange.end) {
          return false;
        }
      }

      // 项目路径
      if (filter.projectPath && trace.projectPath !== filter.projectPath) {
        return false;
      }

      // 会话 ID
      if (filter.sessionId && trace.sessionId !== filter.sessionId) {
        return false;
      }

      // 任务 ID
      if (filter.taskId && trace.taskId !== filter.taskId) {
        return false;
      }

      // 角色 ID
      if (filter.roleId && trace.roleId !== filter.roleId) {
        return false;
      }

      return true;
    });
  }

  /**
   * 检查文件大小，必要时滚动
   */
  private checkFileSize(): void {
    if (!fs.existsSync(this.logFile)) {
      return;
    }

    const stats = fs.statSync(this.logFile);
    if (stats.size >= this.config.maxFileSize!) {
      this.rotateFile();
    }
  }

  /**
   * 滚动文件
   *
   * 将当前文件重命名为带时间戳的备份
   */
  private rotateFile(): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = this.logFile.replace('.log', `-${timestamp}.log`);

    // 重命名当前文件
    fs.renameSync(this.logFile, backupFile);

    // 创建新文件
    fs.writeFileSync(this.logFile, '', 'utf-8');
  }

  /**
   * 清理旧备份文件
   *
   * 删除超过 maxAge 天的备份文件
   */
  cleanupOldFiles(maxAgeDays: number = 30): number {
    const dir = path.dirname(this.logFile);
    if (!fs.existsSync(dir)) {
      return 0;
    }

    const files = fs.readdirSync(dir);
    const baseName = path.basename(this.logFile);
    const backupFiles = files.filter(f => f.endsWith('.log') && f !== baseName);

    const cutoffTime = Date.now() - maxAgeDays * 24 * 3600 * 1000;
    let deletedCount = 0;

    for (const file of backupFiles) {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);

      if (stats.mtimeMs < cutoffTime) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * 获取日志文件统计信息
   */
  getStats(): {
    fileExists: boolean;
    fileSize: number;
    totalRecords: number;
    oldestRecord?: number;
    newestRecord?: number;
  } {
    if (!fs.existsSync(this.logFile)) {
      return { fileExists: false, fileSize: 0, totalRecords: 0 };
    }

    const stats = fs.statSync(this.logFile);
    const content = fs.readFileSync(this.logFile, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    let oldest: number | undefined;
    let newest: number | undefined;

    if (lines.length > 0) {
      const firstTrace = JSON.parse(lines[0]) as PerformanceTrace;
      const lastTrace = JSON.parse(lines[lines.length - 1]) as PerformanceTrace;
      oldest = firstTrace.timestamp;
      newest = lastTrace.timestamp;
    }

    return {
      fileExists: true,
      fileSize: stats.size,
      totalRecords: lines.length,
      oldestRecord: oldest,
      newestRecord: newest,
    };
  }
}
