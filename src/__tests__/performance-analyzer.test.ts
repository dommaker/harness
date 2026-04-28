/**
 * PerformanceAnalyzer 测试
 */

import { PerformanceAnalyzer, createPerformanceAnalyzer } from '../monitoring/performance-analyzer';
import { PerformanceCollector } from '../monitoring/performance-collector';
import type { PerformanceTrace, PerformanceSummary } from '../types/performance';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

// Mock PerformanceCollector
jest.mock('../monitoring/performance-collector', () => ({
  PerformanceCollector: jest.fn().mockImplementation(() => ({
    readRecent: jest.fn().mockReturnValue([]),
    readByOperation: jest.fn().mockReturnValue([]),
  })),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const MockPerformanceCollector = PerformanceCollector as jest.MockedClass<typeof PerformanceCollector>;

describe('PerformanceAnalyzer', () => {
  let analyzer: PerformanceAnalyzer;
  let mockCollector: jest.Mocked<PerformanceCollector>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCollector = new PerformanceCollector() as jest.Mocked<PerformanceCollector>;
    analyzer = new PerformanceAnalyzer(mockCollector);
  });

  describe('summarize', () => {
    it('应该生成空的汇总列表（无 traces）', () => {
      const summaries = analyzer.summarize([]);
      expect(summaries).toEqual([]);
    });

    it('应该按操作类型分组', () => {
      const traces: PerformanceTrace[] = [
        { operation: 'op1', duration: 100, result: 'ok', timestamp: 1000 },
        { operation: 'op1', duration: 200, result: 'ok', timestamp: 2000 },
        { operation: 'op2', duration: 50, result: 'ok', timestamp: 3000 },
      ];

      const summaries = analyzer.summarize(traces);

      expect(summaries.length).toBe(2);
      expect(summaries.find(s => s.operation === 'op1')?.totalCalls).toBe(2);
      expect(summaries.find(s => s.operation === 'op2')?.totalCalls).toBe(1);
    });

    it('应该正确计算统计值', () => {
      const traces: PerformanceTrace[] = [
        { operation: 'test', duration: 100, result: 'ok', timestamp: 1000 },
        { operation: 'test', duration: 200, result: 'exceeded', timestamp: 2000 },
        { operation: 'test', duration: 300, result: 'error', timestamp: 3000 },
      ];

      const summaries = analyzer.summarize(traces);
      const summary = summaries[0];

      expect(summary.totalCalls).toBe(3);
      expect(summary.okCount).toBe(1);
      expect(summary.exceededCount).toBe(1);
      expect(summary.errorCount).toBe(1);
      expect(summary.avgDuration).toBe(200);
      expect(summary.maxDuration).toBe(300);
      expect(summary.minDuration).toBe(100);
      expect(summary.okRate).toBeCloseTo(1/3);
      expect(summary.exceededRate).toBeCloseTo(1/3);
      expect(summary.errorRate).toBeCloseTo(1/3);
    });

    it('应该计算百分位数', () => {
      // 生成 100 个数据点
      const traces: PerformanceTrace[] = [];
      for (let i = 1; i <= 100; i++) {
        traces.push({
          operation: 'test',
          duration: i * 10,
          result: 'ok',
          timestamp: i * 1000,
        });
      }

      const summaries = analyzer.summarize(traces);
      const summary = summaries[0];

      // P95 ≈ 95 * 10 = 950
      expect(summary.p95Duration).toBeGreaterThanOrEqual(900);
      // P99 ≈ 99 * 10 = 990
      expect(summary.p99Duration).toBeGreaterThanOrEqual(980);
    });

    it('应该判断趋势为 stable（少于10个数据）', () => {
      const traces: PerformanceTrace[] = [];
      for (let i = 0; i < 5; i++) {
        traces.push({
          operation: 'test',
          duration: 100,
          result: 'ok',
          timestamp: i * 1000,
        });
      }

      const summaries = analyzer.summarize(traces);
      expect(summaries[0]?.recentTrend).toBe('stable');
    });

    it('应该判断趋势为 rising', () => {
      const traces: PerformanceTrace[] = [];
      // 前半段 100ms，后半段 500ms，变化率 400%
      for (let i = 0; i < 5; i++) {
        traces.push({
          operation: 'test',
          duration: 100,
          result: 'ok',
          timestamp: i * 1000,
        });
      }
      for (let i = 5; i < 10; i++) {
        traces.push({
          operation: 'test',
          duration: 500,
          result: 'ok',
          timestamp: i * 1000,
        });
      }

      const summaries = analyzer.summarize(traces);
      expect(summaries[0]?.recentTrend).toBe('rising');
    });

    it('应该判断趋势为 falling', () => {
      const traces: PerformanceTrace[] = [];
      // 前半段 500ms，后半段 100ms
      for (let i = 0; i < 5; i++) {
        traces.push({
          operation: 'test',
          duration: 500,
          result: 'ok',
          timestamp: i * 1000,
        });
      }
      for (let i = 5; i < 10; i++) {
        traces.push({
          operation: 'test',
          duration: 100,
          result: 'ok',
          timestamp: i * 1000,
        });
      }

      const summaries = analyzer.summarize(traces);
      expect(summaries[0]?.recentTrend).toBe('falling');
    });
  });

  describe('detectAnomalies', () => {
    it('应该检测高平均耗时异常', () => {
      const summaries: PerformanceSummary[] = [{
        operation: 'slow-op',
        timeRange: { start: 1000, end: 2000 },
        totalCalls: 10,
        okCount: 10,
        exceededCount: 0,
        errorCount: 0,
        avgDuration: 6000, // 超过阈值 5000
        maxDuration: 8000,
        minDuration: 5000,
        p95Duration: 7000,
        p99Duration: 7500,
        okRate: 1,
        exceededRate: 0,
        errorRate: 0,
        recentTrend: 'stable',
      }];

      const anomalies = analyzer.detectAnomalies(summaries);

      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies.some(a => a.type === 'high_avg_duration')).toBe(true);
    });

    it('应该检测高超阈值率异常', () => {
      const summaries: PerformanceSummary[] = [{
        operation: 'exceeded-op',
        timeRange: { start: 1000, end: 2000 },
        totalCalls: 10,
        okCount: 6,
        exceededCount: 4,
        errorCount: 0,
        avgDuration: 1000,
        maxDuration: 2000,
        minDuration: 500,
        p95Duration: 1800,
        p99Duration: 1900,
        okRate: 0.6,
        exceededRate: 0.4, // 超过阈值 0.3
        errorRate: 0,
        recentTrend: 'stable',
      }];

      const anomalies = analyzer.detectAnomalies(summaries);

      expect(anomalies.some(a => a.type === 'high_exceeded_rate')).toBe(true);
    });

    it('应该检测高错误率异常', () => {
      const summaries: PerformanceSummary[] = [{
        operation: 'error-op',
        timeRange: { start: 1000, end: 2000 },
        totalCalls: 10,
        okCount: 8,
        exceededCount: 0,
        errorCount: 2,
        avgDuration: 1000,
        maxDuration: 2000,
        minDuration: 500,
        p95Duration: 1800,
        p99Duration: 1900,
        okRate: 0.8,
        exceededRate: 0,
        errorRate: 0.2, // 超过阈值 0.1
        recentTrend: 'stable',
      }];

      const anomalies = analyzer.detectAnomalies(summaries);

      expect(anomalies.some(a => a.type === 'high_error_rate')).toBe(true);
    });

    it('应该检测趋势上升异常', () => {
      const summaries: PerformanceSummary[] = [{
        operation: 'rising-op',
        timeRange: { start: 1000, end: 2000 },
        totalCalls: 10,
        okCount: 10,
        exceededCount: 0,
        errorCount: 0,
        avgDuration: 1000,
        maxDuration: 2000,
        minDuration: 500,
        p95Duration: 1800,
        p99Duration: 1900,
        okRate: 1,
        exceededRate: 0,
        errorRate: 0,
        recentTrend: 'rising',
      }];

      const anomalies = analyzer.detectAnomalies(summaries);

      expect(anomalies.some(a => a.type === 'rising_duration')).toBe(true);
    });

    it('应该返回空数组（无异常）', () => {
      const summaries: PerformanceSummary[] = [{
        operation: 'healthy-op',
        timeRange: { start: 1000, end: 2000 },
        totalCalls: 10,
        okCount: 10,
        exceededCount: 0,
        errorCount: 0,
        avgDuration: 100, // 低于阈值
        maxDuration: 200,
        minDuration: 50,
        p95Duration: 180,
        p99Duration: 190,
        okRate: 1,
        exceededRate: 0,
        errorRate: 0,
        recentTrend: 'stable',
      }];

      const anomalies = analyzer.detectAnomalies(summaries);

      expect(anomalies.length).toBe(0);
    });
  });

  describe('compareWithPrevious', () => {
    it('应该计算环比变化', () => {
      const current: PerformanceSummary[] = [{
        operation: 'test',
        timeRange: { start: 2000, end: 3000 },
        totalCalls: 10,
        okCount: 10,
        exceededCount: 0,
        errorCount: 0,
        avgDuration: 150, // +50
        maxDuration: 200,
        minDuration: 100,
        p95Duration: 180,
        p99Duration: 190,
        okRate: 1,
        exceededRate: 0.05, // +5%
        errorRate: 0,
        recentTrend: 'stable',
      }];

      const previous: PerformanceSummary[] = [{
        operation: 'test',
        timeRange: { start: 1000, end: 2000 },
        totalCalls: 10,
        okCount: 10,
        exceededCount: 0,
        errorCount: 0,
        avgDuration: 100,
        maxDuration: 150,
        minDuration: 50,
        p95Duration: 140,
        p99Duration: 145,
        okRate: 1,
        exceededRate: 0,
        errorRate: 0,
        recentTrend: 'stable',
      }];

      const result = analyzer.compareWithPrevious(current, previous);

      expect(result[0]?.changeFromLastPeriod?.avgDurationDelta).toBe(50);
      expect(result[0]?.changeFromLastPeriod?.exceededRateDelta).toBe(0.05);
    });

    it('应该处理无历史数据的情况', () => {
      const current: PerformanceSummary[] = [{
        operation: 'new-op',
        timeRange: { start: 1000, end: 2000 },
        totalCalls: 10,
        okCount: 10,
        exceededCount: 0,
        errorCount: 0,
        avgDuration: 100,
        maxDuration: 200,
        minDuration: 50,
        p95Duration: 180,
        p99Duration: 190,
        okRate: 1,
        exceededRate: 0,
        errorRate: 0,
        recentTrend: 'stable',
      }];

      const result = analyzer.compareWithPrevious(current, []);

      expect(result[0]?.changeFromLastPeriod).toBeUndefined();
    });
  });

  describe('analyzeRecent', () => {
    it('应该调用 collector.readRecent', () => {
      mockCollector.readRecent.mockReturnValue([]);

      analyzer.analyzeRecent(1);

      expect(mockCollector.readRecent).toHaveBeenCalledWith(1);
    });
  });

  describe('analyzeOperation', () => {
    it('应该调用 collector.readByOperation', () => {
      mockCollector.readByOperation.mockReturnValue([]);

      analyzer.analyzeOperation('test-op');

      expect(mockCollector.readByOperation).toHaveBeenCalledWith('test-op');
    });
  });

  describe('saveSummary / loadSummary', () => {
    it('应该保存汇总结果', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.mkdirSync.mockReturnValue(undefined);

      analyzer.saveSummary([]);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('应该加载汇总结果', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('[]');

      const result = analyzer.loadSummary();

      expect(result).toEqual([]);
    });

    it('应该返回 null（文件不存在）', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = analyzer.loadSummary();

      expect(result).toBeNull();
    });
  });

  describe('runHourlySummary', () => {
    it('应该执行小时汇总', () => {
      mockCollector.readRecent.mockReturnValue([]);
      mockFs.existsSync.mockReturnValue(false);

      const result = analyzer.runHourlySummary();

      expect(mockCollector.readRecent).toHaveBeenCalledWith(1);
      expect(result).toBeDefined();
    });

    it('应该对比上次汇总', () => {
      mockCollector.readRecent.mockReturnValue([]);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('[]');

      analyzer.runHourlySummary();

      expect(mockFs.readFileSync).toHaveBeenCalled();
    });
  });

  describe('runDailyAnomalyCheck', () => {
    it('应该执行每日异常检测', () => {
      mockCollector.readRecent.mockReturnValue([]);

      const anomalies = analyzer.runDailyAnomalyCheck();

      expect(mockCollector.readRecent).toHaveBeenCalledWith(24);
      expect(Array.isArray(anomalies)).toBe(true);
    });
  });

  describe('generateReport', () => {
    it('应该生成报告文本', () => {
      const summaries: PerformanceSummary[] = [{
        operation: 'test',
        timeRange: { start: 1000, end: 2000 },
        totalCalls: 10,
        okCount: 10,
        exceededCount: 0,
        errorCount: 0,
        avgDuration: 100,
        maxDuration: 200,
        minDuration: 50,
        p95Duration: 180,
        p99Duration: 190,
        okRate: 1,
        exceededRate: 0,
        errorRate: 0,
        recentTrend: 'stable',
      }];

      const report = analyzer.generateReport(summaries, []);

      expect(report).toContain('Performance Report');
      expect(report).toContain('test');
      expect(report).toContain('Calls: 10');
      expect(report).toContain('No Anomalies Detected');
    });

    it('应该包含异常信息', () => {
      const summaries: PerformanceSummary[] = [{
        operation: 'slow-op',
        timeRange: { start: 1000, end: 2000 },
        totalCalls: 10,
        okCount: 10,
        exceededCount: 0,
        errorCount: 0,
        avgDuration: 6000,
        maxDuration: 8000,
        minDuration: 5000,
        p95Duration: 7000,
        p99Duration: 7500,
        okRate: 1,
        exceededRate: 0,
        errorRate: 0,
        recentTrend: 'stable',
      }];

      const anomalies = analyzer.detectAnomalies(summaries);
      const report = analyzer.generateReport(summaries, anomalies);

      expect(report).toContain('Anomalies Detected');
      expect(report).toContain('high_avg_duration');
    });
  });

  describe('createPerformanceAnalyzer', () => {
    it('应该创建分析器实例', () => {
      const instance = createPerformanceAnalyzer();
      expect(instance).toBeInstanceOf(PerformanceAnalyzer);
    });
  });
});
