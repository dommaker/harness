/**
 * 失败记录器
 *
 * 文件存储，追加写入，零 Token 成本
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FailureRecord } from './types';

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
 * const recorder = new FailureRecorder({ logFile: '.harness/logs/failures.log' });
 * await recorder.record({
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
  async record(record: FailureRecord): Promise<void> {
    // 检查文件大小，必要时滚动
    await this.rotateIfNeeded();

    // 追加写入（单行 JSON）
    const line = JSON.stringify(record) + '\n';
    fs.appendFileSync(this.logFile, line, 'utf-8');
  }

  /**
   * 批量记录
   */
  async recordBatch(records: FailureRecord[]): Promise<void> {
    for (const record of records) {
      await this.record(record);
    }
  }

  /**
   * 获取历史记录
   */
  async getHistory(limit?: number): Promise<FailureRecord[]> {
    if (!fs.existsSync(this.logFile)) {
      return [];
    }

    const content = fs.readFileSync(this.logFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    const records = lines.map((line) => JSON.parse(line) as FailureRecord);

    if (limit && limit > 0) {
      return records.slice(-limit);
    }

    return records;
  }

  /**
   * 按类型获取记录
   */
  async getByType(type: string, limit?: number): Promise<FailureRecord[]> {
    return this.getFiltered((r) => r.type === type, limit);
  }

  /**
   * 按等级获取记录
   */
  async getByLevel(level: string, limit?: number): Promise<FailureRecord[]> {
    return this.getFiltered((r) => r.level === level, limit);
  }

  /**
   * 按条件过滤记录
   */
  private async getFiltered(
    predicate: (r: FailureRecord) => boolean,
    limit?: number
  ): Promise<FailureRecord[]> {
    const records = await this.getHistory();
    const filtered = records.filter(predicate);
    return limit && limit > 0 ? filtered.slice(-limit) : filtered;
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    total: number;
    byType: Record<string, number>;
    byLevel: Record<string, number>;
  }> {
    const records = await this.getHistory();

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
  async clear(): Promise<void> {
    if (fs.existsSync(this.logFile)) {
      fs.writeFileSync(this.logFile, '', 'utf-8');
    }
  }

  /**
   * 文件滚动
   */
  private async rotateIfNeeded(): Promise<void> {
    if (!fs.existsSync(this.logFile)) {
      return;
    }

    const stats = fs.statSync(this.logFile);
    if (stats.size < this.maxFileSize) {
      return;
    }

    // 滚动文件
    const dir = path.dirname(this.logFile);
    const ext = path.extname(this.logFile);
    const base = path.basename(this.logFile, ext);

    // 删除最旧的历史文件
    const oldestHistory = path.join(dir, `${base}.${this.maxHistoryFiles}${ext}`);
    if (fs.existsSync(oldestHistory)) {
      fs.unlinkSync(oldestHistory);
    }

    // 重命名现有历史文件
    for (let i = this.maxHistoryFiles - 1; i >= 1; i--) {
      const oldFile = path.join(dir, `${base}.${i}${ext}`);
      const newFile = path.join(dir, `${base}.${i + 1}${ext}`);
      if (fs.existsSync(oldFile)) {
        fs.renameSync(oldFile, newFile);
      }
    }

    // 重命名当前文件
    const firstHistory = path.join(dir, `${base}.1${ext}`);
    fs.renameSync(this.logFile, firstHistory);
  }
}

/**
 * 创建失败记录器
 */
export function createFailureRecorder(
  config: FailureRecorderConfig
): FailureRecorder {
  return new FailureRecorder(config);
}
