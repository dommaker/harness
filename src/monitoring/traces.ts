/**
 * Execution Trace 收集器
 *
 * 轻量设计，零 Token 成本
 *
 * 功能：
 * - 记录约束检查结果（追加写入）
 * - 批量读取 traces（按时间范围过滤）
 * - 文件滚动（防止文件过大）
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_TRACE_FILE,
  type ExecutionTrace,
  type TraceFilter,
  type TraceCollectorConfig,
} from '../types/trace';

// 路径常量再导出，保持既有从 monitoring/traces 导入的用法不破
export { DEFAULT_TRACE_FILE };

/**
 * 默认配置
 */
const DEFAULT_CONFIG: TraceCollectorConfig = {
  traceFile: DEFAULT_TRACE_FILE,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  enabled: true,
};

/**
 * Trace 收集器
 *
 * 使用方式：
 * ```typescript
 * const collector = new TraceCollector();
 * collector.record({
 *   constraintId: 'no_fix_without_root_cause',
 *   level: 'iron_law',
 *   timestamp: Date.now(),
 *   result: 'fail',
 * });
 * ```
 */
export class TraceCollector {
  private config: TraceCollectorConfig;
  private traceFile: string;

  constructor(config?: Partial<TraceCollectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.traceFile = this.config.traceFile!;
    this.ensureDirectory();
  }

  /**
   * 确保 trace 目录存在
   */
  private ensureDirectory(): void {
    const dir = path.dirname(this.traceFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 记录一条 trace
   *
   * 轻量操作：
   * - 追加写入（不读取现有内容）
   * - 单行 JSON（便于批量处理）
   * - 零 Token 成本
   */
  record(trace: ExecutionTrace): void {
    if (!this.config.enabled) return;

    // 检查文件大小，必要时滚动
    this.checkFileSize();

    // 追加写入
    const line = JSON.stringify(trace);
    fs.appendFileSync(this.traceFile, line + '\n', 'utf-8');
  }

  /**
   * 快捷方法：记录通过
   */
  recordPass(
    constraintId: string,
    level: 'iron_law' | 'guideline' | 'tip',
    options?: Partial<ExecutionTrace>
  ): void {
    this.record({
      constraintId,
      level,
      timestamp: Date.now(),
      result: 'pass',
      ...options,
    });
  }

  /**
   * 快捷方法：记录失败
   */
  recordFail(
    constraintId: string,
    level: 'iron_law' | 'guideline' | 'tip',
    options?: Partial<ExecutionTrace>
  ): void {
    this.record({
      constraintId,
      level,
      timestamp: Date.now(),
      result: 'fail',
      ...options,
    });
  }

  /**
   * 快捷方法：记录绕过
   */
  recordBypass(
    constraintId: string,
    level: 'iron_law' | 'guideline' | 'tip',
    bypassReason?: string,
    options?: Partial<ExecutionTrace>
  ): void {
    this.record({
      constraintId,
      level,
      timestamp: Date.now(),
      result: 'bypassed',
      userAction: 'bypass',
      bypassReason,
      ...options,
    });
  }

  /**
   * 批量读取 traces
   *
   * 支持过滤条件：
 * - 时间范围
 * - 约束 ID
   * - 结果类型
   */
  read(filter?: TraceFilter): ExecutionTrace[] {
    if (!fs.existsSync(this.traceFile)) {
      return [];
    }

    const content = fs.readFileSync(this.traceFile, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    let traces = lines.map(line => JSON.parse(line) as ExecutionTrace);

    // 应用过滤条件
    if (filter) {
      traces = this.applyFilter(traces, filter);
    }

    return traces;
  }

  /**
   * 读取最近 N 小时的 traces
   */
  readRecent(hours: number): ExecutionTrace[] {
    const start = Date.now() - hours * 3600 * 1000;
    return this.read({ timeRange: { start, end: Date.now() } });
  }

  /**
   * 读取特定约束的 traces
   */
  readByConstraint(constraintId: string): ExecutionTrace[] {
    return this.read({ constraintId });
  }

  /**
   * 应用过滤条件
   */
  private applyFilter(traces: ExecutionTrace[], filter: TraceFilter): ExecutionTrace[] {
    return traces.filter(trace => {
      // 约束 ID
      if (filter.constraintId && trace.constraintId !== filter.constraintId) {
        return false;
      }

      // 层级
      if (filter.level && trace.level !== filter.level) {
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

      return true;
    });
  }

  /**
   * 检查文件大小，必要时滚动
   */
  private checkFileSize(): void {
    if (!fs.existsSync(this.traceFile)) {
      return;
    }

    const stats = fs.statSync(this.traceFile);
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
    const backupFile = this.traceFile.replace('.log', `-${timestamp}.log`);

    // 重命名当前文件
    fs.renameSync(this.traceFile, backupFile);

    // 创建新文件
    fs.writeFileSync(this.traceFile, '', 'utf-8');
  }

  /**
   * 清理旧备份文件
   *
   * 删除超过 maxAge 天的备份文件
   */
  cleanupOldFiles(maxAgeDays: number = 30): number {
    const dir = path.dirname(this.traceFile);
    if (!fs.existsSync(dir)) {
      return 0;
    }

    const files = fs.readdirSync(dir);
    const backupFiles = files.filter(f => f.endsWith('.log') && f !== path.basename(this.traceFile));

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
   * 获取 trace 文件统计信息
   */
  getStats(): {
    fileExists: boolean;
    fileSize: number;
    totalLines: number;
    oldestTrace?: number;
    newestTrace?: number;
  } {
    if (!fs.existsSync(this.traceFile)) {
      return { fileExists: false, fileSize: 0, totalLines: 0 };
    }

    const stats = fs.statSync(this.traceFile);
    const content = fs.readFileSync(this.traceFile, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    let oldest: number | undefined;
    let newest: number | undefined;

    if (lines.length > 0) {
      const firstTrace = JSON.parse(lines[0]) as ExecutionTrace;
      const lastTrace = JSON.parse(lines[lines.length - 1]) as ExecutionTrace;
      oldest = firstTrace.timestamp;
      newest = lastTrace.timestamp;
    }

    return {
      fileExists: true,
      fileSize: stats.size,
      totalLines: lines.length,
      oldestTrace: oldest,
      newestTrace: newest,
    };
  }
}

/**
 * 全局单例（可选）
 */
let globalCollector: TraceCollector | null = null;

/**
 * 获取全局收集器
 */
export function getTraceCollector(): TraceCollector {
  if (!globalCollector) {
    globalCollector = new TraceCollector();
  }
  return globalCollector;
}

/**
 * 配置全局收集器
 */
export function configureTraceCollector(config: Partial<TraceCollectorConfig>): void {
  globalCollector = new TraceCollector(config);
}