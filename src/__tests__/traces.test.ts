/**
 * Execution Trace 测试
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TraceCollector } from '../monitoring/traces';
import { TraceAnalyzer } from '../monitoring/trace-analyzer';
import type { ExecutionTrace } from '../types/trace';

describe('TraceCollector', () => {
  let tempDir: string;
  let collector: TraceCollector;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `harness-traces-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    collector = new TraceCollector({
      traceFile: path.join(tempDir, 'execution.log'),
      enabled: true,
    });
  });

  afterEach(() => {
    // 清理临时目录
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  test('should record a trace', () => {
    collector.record({
      constraintId: 'no_fix_without_root_cause',
      level: 'iron_law',
      timestamp: Date.now(),
      result: 'fail',
      operation: 'code_implementation',
      severity: 'error',
    });

    const traces = collector.read();
    expect(traces.length).toBe(1);
    expect(traces[0].constraintId).toBe('no_fix_without_root_cause');
    expect(traces[0].result).toBe('fail');
  });

  test('should record multiple traces', () => {
    for (let i = 0; i < 5; i++) {
      collector.recordPass('test_constraint', 'guideline');
    }

    const traces = collector.read();
    expect(traces.length).toBe(5);
    expect(traces.every(t => t.result === 'pass')).toBe(true);
  });

  test('should filter traces by constraint ID', () => {
    collector.recordPass('constraint_a', 'iron_law');
    collector.recordFail('constraint_b', 'guideline');
    collector.recordBypass('constraint_a', 'iron_law', 'user reason');

    const traces = collector.read({ constraintId: 'constraint_a' });
    expect(traces.length).toBe(2);
    expect(traces.every(t => t.constraintId === 'constraint_a')).toBe(true);
  });

  test('should filter traces by time range', () => {
    const now = Date.now();
    const oneHourAgo = now - 3600 * 1000;

    collector.record({
      constraintId: 'old_trace',
      level: 'guideline',
      timestamp: oneHourAgo - 1000, // 1小时前更早
      result: 'pass',
    });

    collector.record({
      constraintId: 'new_trace',
      level: 'guideline',
      timestamp: now,
      result: 'pass',
    });

    const traces = collector.read({
      timeRange: { start: oneHourAgo, end: now + 1000 },
    });

    expect(traces.length).toBe(1);
    expect(traces[0].constraintId).toBe('new_trace');
  });

  test('should read recent traces', () => {
    // 记录一些 traces
    for (let i = 0; i < 10; i++) {
      collector.record({
        constraintId: `constraint_${i}`,
        level: 'guideline',
        timestamp: Date.now() - i * 60 * 1000, // 每分钟一个
        result: i % 2 === 0 ? 'pass' : 'fail',
      });
    }

    // 读取最近 5 分钟
    const traces = collector.readRecent(5 / 60); // 5 分钟 = 5/60 小时
    expect(traces.length).toBeLessThanOrEqual(6); // 最多 6 个（包括当前）
  });

  test('should provide stats', () => {
    for (let i = 0; i < 10; i++) {
      collector.recordPass(`constraint_${i}`, 'guideline');
    }

    const stats = collector.getStats();
    expect(stats.fileExists).toBe(true);
    expect(stats.totalLines).toBe(10);
  });
});

describe('TraceAnalyzer', () => {
  let tempDir: string;
  let collector: TraceCollector;
  let analyzer: TraceAnalyzer;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `harness-traces-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    collector = new TraceCollector({
      traceFile: path.join(tempDir, 'execution.log'),
      enabled: true,
    });
    analyzer = new TraceAnalyzer(collector, {
      summaryFile: path.join(tempDir, 'summary.json'),
    });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  test('should summarize traces', () => {
    // 记录不同约束的 traces
    for (let i = 0; i < 10; i++) {
      collector.record({
        constraintId: 'constraint_a',
        level: 'guideline',
        timestamp: Date.now() - i * 60 * 1000,
        result: i < 7 ? 'pass' : 'fail',
      });
    }

    for (let i = 0; i < 5; i++) {
      collector.record({
        constraintId: 'constraint_b',
        level: 'iron_law',
        timestamp: Date.now() - i * 60 * 1000,
        result: i < 3 ? 'pass' : 'bypassed',
      });
    }

    const traces = collector.read();
    const summaries = analyzer.summarize(traces);

    expect(summaries.length).toBe(2);

    const summaryA = summaries.find(s => s.constraintId === 'constraint_a');
    expect(summaryA).toBeDefined();
    expect(summaryA!.totalChecks).toBe(10);
    expect(summaryA!.passRate).toBeCloseTo(0.7, 1);
    expect(summaryA!.failRate).toBeCloseTo(0.3, 1);

    const summaryB = summaries.find(s => s.constraintId === 'constraint_b');
    expect(summaryB).toBeDefined();
    expect(summaryB!.bypassRate).toBeCloseTo(0.4, 1);
  });

  test('should detect high bypass rate anomaly', () => {
    // 记录高绕过率的 traces
    for (let i = 0; i < 10; i++) {
      collector.record({
        constraintId: 'problematic_constraint',
        level: 'guideline',
        timestamp: Date.now(),
        result: i < 3 ? 'pass' : 'bypassed', // 70% 绕过率
      });
    }

    const traces = collector.read();
    const summaries = analyzer.summarize(traces);
    const anomalies = analyzer.detectAnomalies(summaries);

    expect(anomalies.length).toBeGreaterThan(0);
    expect(anomalies.some(a => a.type === 'high_bypass_rate')).toBe(true);
  });

  test('should detect rising fail rate anomaly', () => {
    const now = Date.now();

    // 前半段：低失败率
    for (let i = 0; i < 20; i++) {
      collector.record({
        constraintId: 'rising_fail_constraint',
        level: 'iron_law',
        timestamp: now - (40 - i) * 60 * 1000,
        result: 'pass',
      });
    }

    // 后半段：高失败率（趋势上升）
    for (let i = 0; i < 20; i++) {
      collector.record({
        constraintId: 'rising_fail_constraint',
        level: 'iron_law',
        timestamp: now - i * 60 * 1000,
        result: i < 15 ? 'fail' : 'pass', // 75% 失败率
      });
    }

    const traces = collector.read();
    const summaries = analyzer.summarize(traces);

    // 检查趋势
    const summary = summaries.find(s => s.constraintId === 'rising_fail_constraint');
    expect(summary?.recentTrend).toBe('falling'); // 通过率下降 = 失败率上升
  });

  test('should calculate trend correctly', () => {
    const now = Date.now();

    // 稳定趋势：前后通过率相同
    for (let i = 0; i < 10; i++) {
      collector.record({
        constraintId: 'stable_constraint',
        level: 'guideline',
        timestamp: now - i * 60 * 1000,
        result: 'pass',
      });
    }

    const traces = collector.readByConstraint('stable_constraint');
    const summaries = analyzer.summarize(traces);

    expect(summaries[0].recentTrend).toBe('stable');
  });

  test('should save and load summary', () => {
    for (let i = 0; i < 5; i++) {
      collector.recordPass('test_constraint', 'guideline');
    }

    const summaries = analyzer.analyzeRecent(1);
    analyzer.saveSummary(summaries);

    const loaded = analyzer.loadSummary();
    expect(loaded).toBeDefined();
    expect(loaded!.length).toBe(1);
    expect(loaded![0].constraintId).toBe('test_constraint');
  });

  test('should generate report', () => {
    for (let i = 0; i < 5; i++) {
      collector.recordPass('constraint_a', 'guideline');
      collector.recordFail('constraint_b', 'iron_law');
    }

    const summaries = analyzer.analyzeRecent(1);
    const anomalies = analyzer.detectAnomalies(summaries);
    const report = analyzer.generateReport(summaries, anomalies);

    expect(report).toContain('# Harness Trace Report');
    expect(report).toContain('constraint_a');
    expect(report).toContain('constraint_b');
  });
});