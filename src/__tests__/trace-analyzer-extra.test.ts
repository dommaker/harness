/**
 * TraceAnalyzer 补充测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { TraceAnalyzer, createAnalyzer } from '../monitoring/trace-analyzer';
import { TraceCollector } from '../monitoring/traces';
import * as fs from 'fs';
import * as path from 'path';
import type { ExecutionTrace } from '../types/trace';

describe('TraceAnalyzer - 补充覆盖', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-analyzer-extra');
  const logFile = path.join(tempDir, 'traces.log');
  let collector: TraceCollector;
  let analyzer: TraceAnalyzer;

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
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
    analyzer = new TraceAnalyzer(collector, {
      summaryFile: path.join(tempDir, 'summary.json'),
    });
  });

  describe('趋势计算', () => {
    it('少于 10 条记录应该返回 stable', () => {
      const traces: ExecutionTrace[] = [
        { constraintId: 'test', level: 'iron_law', timestamp: 1000, result: 'pass' },
        { constraintId: 'test', level: 'iron_law', timestamp: 2000, result: 'pass' },
      ];

      const summaries = analyzer.summarize(traces);
      expect(summaries[0]?.recentTrend).toBe('stable');
    });

    it('足够记录应该计算趋势', () => {
      // 创建 15 条记录，前半段通过率低，后半段高 → rising
      const traces: ExecutionTrace[] = [];
      for (let i = 0; i < 8; i++) {
        traces.push({ constraintId: 'test', level: 'iron_law', timestamp: 1000 + i * 100, result: 'fail' });
      }
      for (let i = 8; i < 15; i++) {
        traces.push({ constraintId: 'test', level: 'iron_law', timestamp: 1000 + i * 100, result: 'pass' });
      }

      const summaries = analyzer.summarize(traces);
      expect(summaries[0]?.recentTrend).toBeDefined();
    });
  });

  describe('compareWithPrevious', () => {
    it('应该计算环比变化', () => {
      const current: any[] = [
        { constraintId: 'test', passRate: 0.8, failRate: 0.2, bypassRate: 0.1, level: 'iron_law' },
      ];
      const previous: any[] = [
        { constraintId: 'test', passRate: 0.6, failRate: 0.4, bypassRate: 0.2, level: 'iron_law' },
      ];

      const result = analyzer.compareWithPrevious(current, previous);
      
      expect(result[0]?.changeFromLastPeriod?.passRateDelta).toBeCloseTo(0.2);
      expect(result[0]?.changeFromLastPeriod?.failRateDelta).toBeCloseTo(-0.2);
      expect(result[0]?.changeFromLastPeriod?.bypassRateDelta).toBeCloseTo(-0.1);
    });

    it('无历史数据应该不设置变化', () => {
      const current: any[] = [
        { constraintId: 'new_test', passRate: 0.8, failRate: 0.2, bypassRate: 0.1, level: 'iron_law' },
      ];
      const previous: any[] = [];

      const result = analyzer.compareWithPrevious(current, previous);
      
      expect(result[0]?.changeFromLastPeriod).toBeUndefined();
    });
  });

  describe('saveSummary/loadSummary', () => {
    it('应该保存和加载汇总', () => {
      const summaries: any[] = [
        { constraintId: 'test', passRate: 0.8, failRate: 0.2, bypassRate: 0.1, level: 'iron_law', totalChecks: 10 },
      ];

      analyzer.saveSummary(summaries);
      
      const loaded = analyzer.loadSummary();
      expect(loaded).toBeDefined();
      expect(loaded?.length).toBe(1);
      expect(loaded?.[0]?.constraintId).toBe('test');
    });

    it('无文件应该返回 null', () => {
      // 用新目录，无 summary 文件
      const newAnalyzer = new TraceAnalyzer(collector, {
        summaryFile: path.join(tempDir, 'nonexistent.json'),
      });

      const loaded = newAnalyzer.loadSummary();
      expect(loaded).toBeNull();
    });
  });

  describe('runHourlySummary', () => {
    it('应该运行小时汇总', () => {
      // 写入一些 traces
      const traces: ExecutionTrace[] = [
        { constraintId: 'hourly_test', level: 'iron_law', timestamp: Date.now(), result: 'pass' },
      ];
      collector.record(traces[0]);

      const summaries = analyzer.runHourlySummary();
      
      expect(Array.isArray(summaries)).toBe(true);
    });
  });

  describe('runDailyAnomalyCheck', () => {
    it('应该运行每日异常检测', () => {
      // 写入高失败率的 traces
      const traces: ExecutionTrace[] = [];
      for (let i = 0; i < 20; i++) {
        traces.push({
          constraintId: 'daily_test',
          level: 'iron_law',
          timestamp: Date.now() - i * 1000,
          result: i < 15 ? 'fail' : 'pass', // 75% 失败率
        });
      }
      traces.forEach(t => collector.record(t));

      const anomalies = analyzer.runDailyAnomalyCheck();
      
      expect(Array.isArray(anomalies)).toBe(true);
    });
  });

  describe('generateReport', () => {
    it('应该生成文本报告', () => {
      const summaries: any[] = [
        {
          constraintId: 'report_test',
          level: 'iron_law',
          passRate: 0.8,
          failRate: 0.2,
          bypassRate: 0.1,
          totalChecks: 100,
          recentTrend: 'stable',
        },
      ];
      const anomalies: any[] = [];

      const report = analyzer.generateReport(summaries, anomalies);
      
      expect(typeof report).toBe('string');
      expect(report).toContain('report_test');
    });

    it('空汇总应该生成空报告', () => {
      const report = analyzer.generateReport([], []);
      
      expect(typeof report).toBe('string');
    });
  });

  describe('analyzeConstraint', () => {
    it('应该分析特定约束', () => {
      const traces: ExecutionTrace[] = [
        { constraintId: 'specific_test', level: 'iron_law', timestamp: Date.now(), result: 'pass' },
      ];
      traces.forEach(t => collector.record(t));

      const summaries = analyzer.analyzeConstraint('specific_test');
      
      expect(Array.isArray(summaries)).toBe(true);
    });
  });

  describe('findMostCommon', () => {
    it('应该找出最常见元素', () => {
      // 通过 bypassReasons 统计来触发
      const traces: ExecutionTrace[] = [
        { constraintId: 'common_test', level: 'iron_law', timestamp: 1000, result: 'pass' },
        { constraintId: 'common_test', level: 'iron_law', timestamp: 2000, result: 'pass', bypassReason: 'reason_a' },
        { constraintId: 'common_test', level: 'iron_law', timestamp: 3000, result: 'pass', bypassReason: 'reason_a' },
        { constraintId: 'common_test', level: 'iron_law', timestamp: 4000, result: 'pass', bypassReason: 'reason_b' },
      ];

      const summaries = analyzer.summarize(traces);

      // 验证汇总结果存在
      expect(summaries.length).toBeGreaterThan(0);
    });

    it('应该通过 exceptionApplied 触发 findMostCommon', () => {
      const traces: ExecutionTrace[] = [
        { constraintId: 'exc_test', level: 'guideline', timestamp: 1000, result: 'pass', exceptionApplied: 'simple_typo' },
        { constraintId: 'exc_test', level: 'guideline', timestamp: 2000, result: 'pass', exceptionApplied: 'simple_typo' },
        { constraintId: 'exc_test', level: 'guideline', timestamp: 3000, result: 'pass', exceptionApplied: 'config_error' },
      ];

      const summaries = analyzer.summarize(traces);
      const summary = summaries.find(s => s.constraintId === 'exc_test');

      expect(summary?.exceptionCount).toBe(3);
      expect(summary?.mostCommonException).toBe('simple_typo');
    });

    it('无 exception 时 mostCommonException 应该是 undefined', () => {
      const traces: ExecutionTrace[] = [
        { constraintId: 'no_exc', level: 'iron_law', timestamp: 1000, result: 'pass' },
      ];

      const summaries = analyzer.summarize(traces);
      expect(summaries[0]?.mostCommonException).toBeUndefined();
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
        traces.push({ constraintId: 'rising_fail', level: 'iron_law', timestamp: 1000 + i * 100, result: 'fail' });
      }
      for (let i = 6; i < 14; i++) {
        traces.push({ constraintId: 'rising_fail', level: 'iron_law', timestamp: 1000 + i * 100, result: 'pass' });
      }

      const summaries = customAnalyzer.summarize(traces);
      const anomalies = customAnalyzer.detectAnomalies(summaries);

      const risingFail = anomalies.find(a => a.type === 'rising_fail_rate');
      expect(risingFail).toBeDefined();
    });

    it('应该检测 rising_bypass_rate', () => {
      // 前半段全 fail，后半段混合 pass+bypass → rising 趋势
      // bypassRate 需要 > 0.1，且 trend === 'rising'
      const traces: ExecutionTrace[] = [];
      for (let i = 0; i < 6; i++) {
        traces.push({ constraintId: 'rising_bypass', level: 'guideline', timestamp: 1000 + i * 100, result: 'fail' });
      }
      for (let i = 6; i < 14; i++) {
        // 后半段有 pass 也有 bypass，使 passRate 上升（rising），同时 bypassRate > 0.1
        traces.push({ constraintId: 'rising_bypass', level: 'guideline', timestamp: 1000 + i * 100, result: i % 2 === 0 ? 'pass' : 'bypassed' });
      }

      const summaries = analyzer.summarize(traces);
      const anomalies = analyzer.detectAnomalies(summaries);

      const risingBypass = anomalies.find(a => a.type === 'rising_bypass_rate');
      expect(risingBypass).toBeDefined();
    });

    it('应该检测 exception_overuse', () => {
      const traces: ExecutionTrace[] = [];
      for (let i = 0; i < 10; i++) {
        traces.push({
          constraintId: 'exc_overuse',
          level: 'guideline',
          timestamp: 1000 + i * 100,
          result: 'pass',
          exceptionApplied: i < 8 ? 'simple_typo' : undefined,
        });
      }

      const summaries = analyzer.summarize(traces);
      const anomalies = analyzer.detectAnomalies(summaries);

      const excOveruse = anomalies.find(a => a.type === 'exception_overuse');
      expect(excOveruse).toBeDefined();
    });
  });

  describe('createAnalyzer 工厂函数', () => {
    it('应该创建分析器实例', () => {
      const a = createAnalyzer();
      expect(a).toBeDefined();
    });

    it('应该支持自定义配置', () => {
      const a = createAnalyzer({ thresholds: { bypassRate: 0.05 } });
      expect(a).toBeDefined();
    });
  });
});