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
import { readJsonl, appendJsonl } from '../utils/jsonl';
import {
  DEFAULT_TRACE_FILE,
  type ExecutionTrace,
  type TraceFilter,
  type TraceCollectorConfig,
} from '../types/trace';

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

    // 追加写入（写链收口：ensureDir + append，harness#82）
    appendJsonl(this.traceFile, trace);
  }

  /**
   * 快捷方法：记录通过
   */
  recordPass(
    constraintId: string,
    level: 'iron_law' | 'guideline',
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
    level: 'iron_law' | 'guideline',
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
   * 批量读取 traces
   *
   * 支持过滤条件：
 * - 时间范围
 * - 约束 ID
   * - 结果类型
   */
  read(filter?: TraceFilter): ExecutionTrace[] {
    // 坏行策略：skip（harness#82 裁决 4：原裸 parse「抛」改 skip，
    // 签名与返回类型不变——studio 两侧点经 readRecent/readByConstraint 活消费）
    const { records } = readJsonl<ExecutionTrace>(this.traceFile, 'skip');

    return filter ? this.applyFilter(records, filter) : records;
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
    // 坏行策略：skip（同 read，裁决 4）；首/末时间戳取首/末条合法记录；
    // totalLines 保持原始非空行数口径（合法 + 坏行）
    const { records, skippedLines } = readJsonl<ExecutionTrace>(this.traceFile, 'skip');

    let oldestTrace: number | undefined;
    let newestTrace: number | undefined;

    if (records.length > 0) {
      oldestTrace = records[0].timestamp;
      newestTrace = records[records.length - 1].timestamp;
    }

    return {
      fileExists: true,
      fileSize: stats.size,
      totalLines: records.length + skippedLines,
      oldestTrace,
      newestTrace,
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