/**
 * 上下文使用追踪
 *
 * 记录每次 LLM 调用的上下文使用快照
 * 存储：.harness/logs/context-tracker.log（JSONL）
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ContextUsageSnapshot } from '../context/types';

export interface ContextAverages {
  avgTokens: number;
  avgCompactionRate: number;
  avgToolOutputRatio: number;
}

export class ContextTracker {
  private logPath: string;
  private maxFileSize: number = 10 * 1024 * 1024; // 10MB

  constructor(basePath?: string) {
    const base = basePath || process.cwd();
    this.logPath = path.join(base, '.harness', 'logs', 'context-tracker.log');
  }

  /**
   * 记录上下文使用快照
   */
  record(snapshot: ContextUsageSnapshot): void {
    const dir = path.dirname(this.logPath);

    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 检查文件大小，超过限制时轮转
      if (fs.existsSync(this.logPath)) {
        const stat = fs.statSync(this.logPath);
        if (stat.size > this.maxFileSize) {
          this.rotateFile();
        }
      }

      const line = JSON.stringify(snapshot) + '\n';
      fs.appendFileSync(this.logPath, line, 'utf-8');
    } catch {
      // 静默失败，不影响主流程
    }
  }

  /**
   * 获取最近 N 条记录
   */
  getRecent(n: number): ContextUsageSnapshot[] {
    try {
      if (!fs.existsSync(this.logPath)) {
        return [];
      }

      const content = fs.readFileSync(this.logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const recent = lines.slice(-n);

      return recent.map(line => {
        try {
          return JSON.parse(line) as ContextUsageSnapshot;
        } catch {
          return null;
        }
      }).filter((s): s is ContextUsageSnapshot => s !== null);
    } catch {
      return [];
    }
  }

  /**
   * 获取统计均值
   */
  getAverages(): ContextAverages {
    const snapshots = this.getRecent(100);

    if (snapshots.length === 0) {
      return { avgTokens: 0, avgCompactionRate: 0, avgToolOutputRatio: 0 };
    }

    const totalTokens = snapshots.reduce((sum, s) => sum + s.totalTokens, 0);
    const compactionCount = snapshots.filter(s => s.compactionTriggered).length;
    const toolOutputTokens = snapshots.reduce((sum, s) => sum + s.breakdown.toolOutputs, 0);
    const totalAllTokens = snapshots.reduce((sum, s) => sum + s.totalTokens, 0);

    return {
      avgTokens: Math.round(totalTokens / snapshots.length),
      avgCompactionRate: compactionCount / snapshots.length,
      avgToolOutputRatio: totalAllTokens > 0 ? toolOutputTokens / totalAllTokens : 0,
    };
  }

  /**
   * 检测上下文问题
   */
  detectIssues(): string[] {
    const issues: string[] = [];
    const averages = this.getAverages();
    const recent = this.getRecent(10);

    // 利用率过高
    if (averages.avgTokens > 0) {
      // 假设 128k 窗口，利用率 >90% 警告
      const utilization = averages.avgTokens / 128000;
      if (utilization > 0.9) {
        issues.push(`上下文利用率过高 (${(utilization * 100).toFixed(0)}%)，建议触发压缩`);
      }
    }

    // 工具输出占比过高
    if (averages.avgToolOutputRatio > 0.4) {
      issues.push(`工具输出占比过高 (${(averages.avgToolOutputRatio * 100).toFixed(0)}%)，建议增加预算控制`);
    }

    // 压缩频率过高
    if (averages.avgCompactionRate > 0.3) {
      issues.push(`压缩触发频率过高 (${(averages.avgCompactionRate * 100).toFixed(0)}%)，建议增加预算或优化上下文`);
    }

    // 最近有截断
    const recentTruncations = recent.filter(s => s.truncatedItems.length > 0);
    if (recentTruncations.length > 5) {
      issues.push(`最近 ${recentTruncations.length} 次调用有截断，建议优化内容大小`);
    }

    return issues;
  }

  /**
   * 轮转日志文件
   */
  private rotateFile(): void {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedPath = this.logPath.replace('.log', `-${timestamp}.log`);
      fs.renameSync(this.logPath, rotatedPath);
    } catch {
      // 轮转失败，静默处理
    }
  }
}
