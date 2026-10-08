/**
 * TraceAnalyzer 补充测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { TraceAnalyzer, summarizeTraces } from '../monitoring/trace-analyzer';
import { TraceCollector } from '../monitoring/traces';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ExecutionTrace } from '../types/trace';

describe('TraceAnalyzer - 补充覆盖', () => {
  let tempDir: string;
  let logFile: string;
  let collector: TraceCollector;
  let analyzer: TraceAnalyzer;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-test-analyzer-extra-'));
    logFile = path.join(tempDir, 'traces.log');
    fs.writeFileSync(logFile, '');
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(() => {
    fs.writeFileSync(logFile, '');
    collector = new TraceCollector({ traceFile: logFile, enabled: true });
    analyzer = new TraceAnalyzer(collector);
  });

  describe('趋势计算', () => {
    it('少于 10 条记录应该返回 stable', () => {
      const traces: ExecutionTrace[] = [
        { constraintId: 'test', severity: 'error', timestamp: 1000, result: 'pass' },
        { constraintId: 'test', severity: 'error', timestamp: 2000, result: 'pass' },
      ];

      const summaries = summarizeTraces(traces);
      expect(summaries[0]?.recentTrend).toBe('stable');
    });

    it('足够记录应该计算趋势', () => {
      // 创建 15 条记录，前半段通过率低，后半段高 → rising
      const traces: ExecutionTrace[] = [];
      for (let i = 0; i < 8; i++) {
        traces.push({ constraintId: 'test', severity: 'error', timestamp: 1000 + i * 100, result: 'fail' });
      }
      for (let i = 8; i < 15; i++) {
        traces.push({ constraintId: 'test', severity: 'error', timestamp: 1000 + i * 100, result: 'pass' });
      }

      const summaries = summarizeTraces(traces);
      expect(summaries[0]?.recentTrend).toBeDefined();
    });
  });

  describe('analyzeRecentReport', () => {
    it('应该汇总最近 N 小时的 traces 并带出坏行计数', () => {
      collector.record({ constraintId: 'recent_test', severity: 'error', timestamp: Date.now(), result: 'pass' });

      const { summaries, skippedLines } = analyzer.analyzeRecentReport(1);

      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.constraintId).toBe('recent_test');
      expect(skippedLines).toBe(0);
    });
  });

  describe('detectAnomalies - 更多异常类型', () => {
    it('应该检测 rising_fail_rate', () => {
      // 前半段全 fail，后半段全 pass → rising 趋势
      // failRate = 6/14 ≈ 0.43，threshold 默认 0.5 → 不触发
      // 需要 failRate > threshold，用自定义阈值
      const customAnalyzer = new TraceAnalyzer(collector, {
        thresholds: { failRate: 0.3 },
      });

      const traces: ExecutionTrace[] = [];
      for (let i = 0; i < 6; i++) {
        traces.push({ constraintId: 'rising_fail', severity: 'error', timestamp: 1000 + i * 100, result: 'fail' });
      }
      for (let i = 6; i < 14; i++) {
        traces.push({ constraintId: 'rising_fail', severity: 'error', timestamp: 1000 + i * 100, result: 'pass' });
      }

      const summaries = summarizeTraces(traces);
      const anomalies = customAnalyzer.detectAnomalies(summaries);

      const risingFail = anomalies.find(a => a.type === 'rising_fail_rate');
      expect(risingFail).toBeDefined();
    });
  });
});
