/**
 * TraceAnalyzer 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { TraceAnalyzer } from '../monitoring/trace-analyzer';
import { TraceCollector } from '../monitoring/traces';
import * as fs from 'fs';
import * as path from 'path';
import type { ExecutionTrace } from '../types/trace';

describe('TraceAnalyzer', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-analyzer');
  const logFile = path.join(tempDir, 'traces.log');
  let collector: TraceCollector;
  let analyzer: TraceAnalyzer;

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(logFile, '');
    collector = new TraceCollector({ traceFile: logFile, enabled: true });
    analyzer = new TraceAnalyzer(collector);
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('summarize', () => {
    it('应该生成统计汇总', () => {
      const traces: ExecutionTrace[] = [
        { constraintId: 'test1', level: 'iron_law', timestamp: 1000, result: 'pass' },
        { constraintId: 'test1', level: 'iron_law', timestamp: 2000, result: 'fail' },
        { constraintId: 'test2', level: 'guideline', timestamp: 3000, result: 'pass' },
      ];

      const summaries = analyzer.summarize(traces);

      expect(summaries.length).toBe(2);
    });

    it('应该计算通过率', () => {
      const traces: ExecutionTrace[] = [
        { constraintId: 'test', level: 'iron_law', timestamp: 1000, result: 'pass' },
        { constraintId: 'test', level: 'iron_law', timestamp: 2000, result: 'pass' },
        { constraintId: 'test', level: 'iron_law', timestamp: 3000, result: 'fail' },
      ];

      const summaries = analyzer.summarize(traces);
      const summary = summaries.find(s => s.constraintId === 'test');

      expect(summary?.passRate).toBeCloseTo(2/3);
    });

    it('应该计算失败率', () => {
      const traces: ExecutionTrace[] = [
        { constraintId: 'test', level: 'iron_law', timestamp: 1000, result: 'fail' },
        { constraintId: 'test', level: 'iron_law', timestamp: 2000, result: 'fail' },
      ];

      const summaries = analyzer.summarize(traces);
      const summary = summaries.find(s => s.constraintId === 'test');

      expect(summary?.failRate).toBeCloseTo(1);
    });

    it('空 traces 应该返回空数组', () => {
      const summaries = analyzer.summarize([]);
      expect(summaries).toEqual([]);
    });
  });

  describe('detectAnomalies', () => {
    it('应该检测高绕过率异常', () => {
      const traces: ExecutionTrace[] = [
        { constraintId: 'test', level: 'guideline', timestamp: 1000, result: 'bypassed' },
        { constraintId: 'test', level: 'guideline', timestamp: 2000, result: 'bypassed' },
        { constraintId: 'test', level: 'guideline', timestamp: 3000, result: 'bypassed' },
        { constraintId: 'test', level: 'guideline', timestamp: 4000, result: 'pass' },
      ];

      const summaries = analyzer.summarize(traces);
      const anomalies = analyzer.detectAnomalies(summaries);

      expect(anomalies.length).toBeGreaterThan(0);
    });

    it('正常数据应该无异常', () => {
      const traces: ExecutionTrace[] = [
        { constraintId: 'test', level: 'iron_law', timestamp: 1000, result: 'pass' },
        { constraintId: 'test', level: 'iron_law', timestamp: 2000, result: 'pass' },
      ];

      const summaries = analyzer.summarize(traces);
      const anomalies = analyzer.detectAnomalies(summaries);

      expect(anomalies.length).toBe(0);
    });
  });

  describe('groupByConstraint', () => {
    it('应该按约束 ID 分组', () => {
      const traces: ExecutionTrace[] = [
        { constraintId: 'a', level: 'iron_law', timestamp: 1000, result: 'pass' },
        { constraintId: 'b', level: 'iron_law', timestamp: 2000, result: 'pass' },
        { constraintId: 'a', level: 'iron_law', timestamp: 3000, result: 'pass' },
      ];

      // 通过 summarize 间接验证分组
      const summaries = analyzer.summarize(traces);
      expect(summaries.length).toBe(2);
    });
  });

  describe('配置', () => {
    it('应该支持自定义阈值', () => {
      const customAnalyzer = new TraceAnalyzer(collector, {
        thresholds: {
          bypassRate: 0.1,
          failRate: 0.2,
        },
      });

      expect(customAnalyzer).toBeDefined();
    });
  });
});