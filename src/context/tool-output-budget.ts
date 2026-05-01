/**
 * 工具输出预算
 *
 * 控制工具输出对上下文的占用
 * 策略：full / preview / overflow / dedup
 */

import * as crypto from 'crypto';
import { TokenEstimator } from './token-budget';
import type { ToolOutputBudgetConfig } from './types';
import { DEFAULT_TOOL_OUTPUT_BUDGET } from './types';

export type OutputStrategy = 'full' | 'preview' | 'overflow' | 'dedup';

export interface OutputCheckResult {
  allowed: boolean;
  strategy: OutputStrategy;
  reason?: string;
}

export interface OutputApplyResult {
  content: string;
  offloaded?: { path: string };
  originalTokens: number;
  keptTokens: number;
}

export class ToolOutputBudget {
  private config: ToolOutputBudgetConfig;
  private seenHashes: Map<string, boolean> = new Map();

  constructor(config?: Partial<ToolOutputBudgetConfig>) {
    this.config = { ...DEFAULT_TOOL_OUTPUT_BUDGET, ...config };
  }

  /**
   * 检查工具输出应该使用什么策略
   */
  checkOutput(output: string, totalBudget?: number): OutputCheckResult {
    const charCount = output.length;
    const tokens = TokenEstimator.estimateText(output);

    // 去重检查
    if (this.config.dedup) {
      const hash = this.computeHash(output);
      if (this.seenHashes.has(hash)) {
        return { allowed: true, strategy: 'dedup', reason: '重复内容，将被去重' };
      }
      // 记录 hash（无论最终策略是什么）
      this.seenHashes.set(hash, true);
    }

    // 硬上限检查
    if (charCount > this.config.maxChars) {
      return {
        allowed: true,
        strategy: this.config.overflowToDisk ? 'overflow' : 'preview',
        reason: `输出 ${charCount} 字符超过限制 ${this.config.maxChars}`,
      };
    }

    // Token 比例检查
    if (totalBudget) {
      const maxTokens = totalBudget * this.config.maxTokenRatio;
      if (tokens > maxTokens) {
        return {
          allowed: true,
          strategy: 'preview',
          reason: `输出 ${tokens} tokens 超过预算比例 ${(this.config.maxTokenRatio * 100).toFixed(0)}% (${Math.floor(maxTokens)} tokens)`,
        };
      }
    }

    return { allowed: true, strategy: 'full' };
  }

  /**
   * 应用预算策略
   */
  applyBudget(output: string, strategy: OutputStrategy, totalBudget?: number): OutputApplyResult {
    const originalTokens = TokenEstimator.estimateText(output);

    switch (strategy) {
      case 'full': {
        if (this.config.dedup) {
          this.recordHash(output);
        }
        return { content: output, originalTokens, keptTokens: originalTokens };
      }

      case 'preview': {
        const preview = this.generatePreview(output);
        const keptTokens = TokenEstimator.estimateText(preview);
        return { content: preview, originalTokens, keptTokens };
      }

      case 'overflow': {
        const path = this.writeToOverflow(output);
        const summary = `[输出已写入磁盘: ${path}]\n前 ${this.config.previewLines} 行预览:\n${output.split('\n').slice(0, this.config.previewLines).join('\n')}`;
        const keptTokens = TokenEstimator.estimateText(summary);
        return { content: summary, offloaded: { path }, originalTokens, keptTokens };
      }

      case 'dedup': {
        const dedupContent = `[重复内容，已省略。原始大小: ${output.length} 字符]`;
        return { content: dedupContent, originalTokens, keptTokens: TokenEstimator.estimateText(dedupContent) };
      }

      default:
        return { content: output, originalTokens, keptTokens: originalTokens };
    }
  }

  /**
   * 生成预览内容
   */
  private generatePreview(output: string): string {
    const lines = output.split('\n');
    const previewLines = this.config.previewLines;

    if (lines.length <= previewLines) {
      return output;
    }

    const head = lines.slice(0, previewLines).join('\n');
    const omitted = lines.length - previewLines;
    return `${head}\n\n... [省略 ${omitted} 行] ...\n\n${lines.slice(-3).join('\n')}`;
  }

  /**
   * 写入溢出文件
   */
  private writeToOverflow(output: string): string {
    const hash = this.computeHash(output).slice(0, 8);
    const path = `.harness/overflow/tool-output-${hash}.txt`;

    try {
      const fs = require('fs');
      const dir = require('path').dirname(path);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path, output, 'utf-8');
    } catch {
      // 写入失败时回退到 preview
      return '';
    }

    return path;
  }

  /**
   * 计算内容 hash
   */
  private computeHash(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * 记录已见 hash
   */
  private recordHash(content: string): void {
    const hash = this.computeHash(content);
    this.seenHashes.set(hash, true);
  }

  /**
   * 清除去重缓存
   */
  clearDedupCache(): void {
    this.seenHashes.clear();
  }

  /**
   * 获取配置
   */
  getConfig(): ToolOutputBudgetConfig {
    return { ...this.config };
  }
}
