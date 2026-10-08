/**
 * 失败记录器
 *
 * 文件存储，追加写入，零 Token 成本
 */

import * as fs from 'fs';
import * as path from 'path';
import { readJsonl, appendJsonl } from '../utils/jsonl';
import { rotateNumbered } from '../utils/log-rotate';
import type { FailureRecord } from '../types/failure';

/**
 * 失败记录器配置
 */
export interface FailureRecorderConfig {
  /** 日志文件路径 */
  logFile: string;
  /** 单文件最大大小（字节），默认 10MB */
  maxFileSize?: number;
  /** 保留历史文件数，默认 5 */
  maxHistoryFiles?: number;
}

/**
 * 失败记录器
 *
 * 用法：
 * ```typescript
 * const recorder = new FailureRecorder({ logFile: DEFAULT_FAILURE_LOG_FILE });
 * recorder.record({
 *   type: ErrorType.TEST_FAILED,
 *   level: FailureLevel.L1,
 *   message: 'Test failed',
 *   timestamp: Date.now(),
 * });
 * ```
 */
export class FailureRecorder {
  private logFile: string;
  private maxFileSize: number;
  private maxHistoryFiles: number;

  constructor(config: FailureRecorderConfig) {
    this.logFile = config.logFile;
    this.maxFileSize = config.maxFileSize ?? 10 * 1024 * 1024; // 10MB
    this.maxHistoryFiles = config.maxHistoryFiles ?? 5;

    // 确保目录存在
    const dir = path.dirname(this.logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * 记录失败
   */
  record(record: FailureRecord): void {
    // 检查文件大小，必要时滚动
    this.rotateIfNeeded();

    // 追加写入单行 JSON（写链收口：ensureDir + append，harness#82）
    appendJsonl(this.logFile, record);
  }

  /**
   * 获取历史记录
   *
   * 坏行策略：显式 skip（harness#96 定稿：跳过 + stderr 一次性计数警告，
   * stdout 含 --json 逐字节不变、退出码 0——#82 只把本调用点改走 jsonl
   * 读链正本并吸收 #96 的局部跳过实现，对外行为不变）。
   * 计数去向：透传（harness#100 四消费点之一）——skippedLines 进下面那句 console.error，
   * #96 定稿的文案与退出码本票逐字不动。
   */
  getHistory(limit?: number): FailureRecord[] {
    const { records, skippedLines } = readJsonl<FailureRecord>(this.logFile, 'skip');
    if (skippedLines > 0) {
      console.error(`[harness] ${path.basename(this.logFile)} 跳过 ${skippedLines} 行损坏记录`);
    }

    if (limit && limit > 0) {
      return records.slice(-limit);
    }

    return records;
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    total: number;
    byType: Record<string, number>;
    byLevel: Record<string, number>;
  } {
    const records = this.getHistory();

    const byType: Record<string, number> = {};
    const byLevel: Record<string, number> = {};

    for (const record of records) {
      byType[record.type] = (byType[record.type] ?? 0) + 1;
      byLevel[record.level] = (byLevel[record.level] ?? 0) + 1;
    }

    return {
      total: records.length,
      byType,
      byLevel,
    };
  }

  /**
   * 清空记录
   */
  clear(): void {
    if (fs.existsSync(this.logFile)) {
      fs.writeFileSync(this.logFile, '', 'utf-8');
    }
  }

  /**
   * 文件滚动（实现正本 = utils/log-rotate；大小阈值判定留本模块）
   */
  private rotateIfNeeded(): void {
    if (!fs.existsSync(this.logFile)) {
      return;
    }

    const stats = fs.statSync(this.logFile);
    if (stats.size < this.maxFileSize) {
      return;
    }

    rotateNumbered(this.logFile, this.maxHistoryFiles);
  }
}
