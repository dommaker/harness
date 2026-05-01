/**
 * 文件读取预算
 *
 * 按行数、字节数、Token 数三重限制读取文件
 * 超限时生成 continuationHint 提示 offset
 */

import * as fs from 'fs';
import { TokenEstimator } from './token-budget';
import type { FileBudgetConfig } from './types';
import { DEFAULT_FILE_BUDGET } from './types';

export interface FileCheckResult {
  allowed: boolean;
  reason?: string;
  lineCount?: number;
  byteCount?: number;
}

export interface FileReadResult {
  content: string;
  truncated: boolean;
  linesRead: number;
  bytesRead: number;
  tokensEstimate: number;
  continuationHint?: string;
}

export class FileBudget {
  private config: FileBudgetConfig;

  constructor(config?: Partial<FileBudgetConfig>) {
    this.config = { ...DEFAULT_FILE_BUDGET, ...config };
  }

  /**
   * 检查文件是否在预算内（stat 检查）
   */
  checkFile(filePath: string): FileCheckResult {
    try {
      const stat = fs.statSync(filePath);

      if (stat.size > this.config.maxBytes) {
        return {
          allowed: false,
          reason: `文件大小 ${(stat.size / 1024).toFixed(1)}KB 超过限制 ${(this.config.maxBytes / 1024).toFixed(1)}KB`,
          byteCount: stat.size,
        };
      }

      return { allowed: true, byteCount: stat.size };
    } catch (error) {
      return {
        allowed: false,
        reason: `无法读取文件: ${(error as Error).message}`,
      };
    }
  }

  /**
   * 按预算读取文件
   *
   * 三重限制：行数 → 字节数 → Token 数
   */
  readWithBudget(filePath: string, config?: Partial<FileBudgetConfig>): FileReadResult {
    const effectiveConfig = { ...this.config, ...config };

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      let truncated = false;
      let selectedLines = lines;
      let continuationHint: string | undefined;

      // 限制 1: 行数
      if (lines.length > effectiveConfig.maxLines) {
        selectedLines = lines.slice(0, effectiveConfig.maxLines);
        truncated = true;

        if (effectiveConfig.continuationHint) {
          continuationHint = `文件被截断。已读取 ${effectiveConfig.maxLines} 行，共 ${lines.length} 行。使用 offset=${effectiveConfig.maxLines} 继续读取。`;
        }
      }

      let result = selectedLines.join('\n');

      // 限制 2: 字节数
      const byteCount = Buffer.byteLength(result, 'utf-8');
      if (byteCount > effectiveConfig.maxBytes) {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(result);
        const truncatedBytes = bytes.slice(0, effectiveConfig.maxBytes);
        result = new TextDecoder().decode(truncatedBytes);
        truncated = true;

        if (!continuationHint && effectiveConfig.continuationHint) {
          continuationHint = `文件内容被截断。已读取 ${effectiveConfig.maxBytes} 字节。`;
        }
      }

      // 限制 3: Token 数
      const tokensEstimate = TokenEstimator.estimateText(result);
      if (tokensEstimate > effectiveConfig.maxTokenEstimate) {
        // 按比例截断
        const ratio = effectiveConfig.maxTokenEstimate / tokensEstimate;
        const charLimit = Math.floor(result.length * ratio);
        result = result.slice(0, charLimit);
        truncated = true;

        if (!continuationHint && effectiveConfig.continuationHint) {
          continuationHint = `文件内容被截断。已读取约 ${effectiveConfig.maxTokenEstimate} tokens。`;
        }
      }

      return {
        content: result,
        truncated,
        linesRead: selectedLines.length,
        bytesRead: Buffer.byteLength(result, 'utf-8'),
        tokensEstimate: TokenEstimator.estimateText(result),
        continuationHint,
      };
    } catch (error) {
      return {
        content: '',
        truncated: false,
        linesRead: 0,
        bytesRead: 0,
        tokensEstimate: 0,
        continuationHint: `无法读取文件: ${(error as Error).message}`,
      };
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): FileBudgetConfig {
    return { ...this.config };
  }
}
