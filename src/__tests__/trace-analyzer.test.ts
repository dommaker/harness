/**
 * TraceAnalyzer 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import {
  TraceAnalyzer,
  summarizeTraces,
  detectTraceAnomalies,
} from '../monitoring/trace-analyzer';
import { TraceCollector } from '../monitoring/traces';
import * as fs from 'fs';
import * as path from 'path';
import type { ExecutionTrace, TraceSummary } from '../types/trace';

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
    it('应该检测失败率异常', () => {
      const traces: ExecutionTrace[] = [
        { constraintId: 'test', level: 'guideline', timestamp: 1000, result: 'fail' },
        { constraintId: 'test', level: 'guideline', timestamp: 2000, result: 'fail' },
        { constraintId: 'test', level: 'guideline', timestamp: 3000, result: 'fail' },
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
          failRate: 0.2,
        },
      });

      expect(customAnalyzer).toBeDefined();
    });
  });

  // ADR-0020：summarize / detectAnomalies 的判定本体住在模块级纯函数上，
  // 类壳只是转发。下面两枚用例直调模块级函数，钉住这个 interface——
  // 经类壳的既有覆盖（上文）删不掉它，反之它也不依赖任何 collector/文件 IO。
  describe('模块级纯函数', () => {
    it('summarizeTraces 不构造 collector 即可汇总，skip 不进 pass/fail 分母', () => {
      const traces: ExecutionTrace[] = [
        { constraintId: 'pure', level: 'iron_law', timestamp: 1000, result: 'pass' },
        { constraintId: 'pure', level: 'iron_law', timestamp: 2000, result: 'fail' },
        { constraintId: 'pure', level: 'iron_law', timestamp: 3000, result: 'skip' },
      ];

      const summaries = summarizeTraces(traces);

      expect(summaries).toHaveLength(1);
      const summary = summaries[0];
      expect(summary.constraintId).toBe('pure');
      expect(summary.totalChecks).toBe(3);
      expect(summary.skipCount).toBe(1);
      expect(summary.passRate).toBeCloseTo(0.5);
      expect(summary.failRate).toBeCloseTo(0.5);
    });

    it('detectTraceAnomalies 的阈值经参数传入，默认与自定义各判一次', () => {
      // failRate 6/14 ≈ 0.43 且趋势上升：默认阈值 0.5 不触发，0.3 触发
      const summary: TraceSummary = {
        constraintId: 'param_threshold',
        level: 'iron_law',
        timeRange: { start: 1000, end: 2400 },
        totalChecks: 14,
        passCount: 8,
        failCount: 6,
        ignoreCount: 0,
        passRate: 8 / 14,
        failRate: 6 / 14,
        recentTrend: 'rising',
      };

      expect(detectTraceAnomalies([summary])).toEqual([]);

      const anomalies = detectTraceAnomalies([summary], { thresholds: { failRate: 0.3 } });
      const rising = anomalies.find(a => a.type === 'rising_fail_rate');
      expect(rising?.constraintId).toBe('param_threshold');
      expect(rising?.data.threshold).toBe(0.3);
    });
  });
});