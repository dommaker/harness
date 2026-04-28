/**
 * TraceCollector 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { TraceCollector } from '../monitoring/traces';
import * as fs from 'fs';
import * as path from 'path';
import type { ExecutionTrace } from '../types/trace';

describe('TraceCollector', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-traces');
  const traceFile = path.join(tempDir, 'traces.log');
  let collector: TraceCollector;

  beforeAll(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  beforeEach(() => {
    // 清空 trace 文件
    fs.writeFileSync(traceFile, '');
    collector = new TraceCollector({ traceFile, enabled: true });
  });

  describe('record', () => {
    it('应该记录 trace', () => {
      const trace: ExecutionTrace = {
        constraintId: 'no_bypass_checkpoint',
        level: 'iron_law',
        timestamp: Date.now(),
        result: 'pass',
      };

      collector.record(trace);

      const content = fs.readFileSync(traceFile, 'utf-8');
      expect(content).toContain('no_bypass_checkpoint');
      expect(content).toContain('pass');
    });

    it('禁用时应该不记录', () => {
      const disabledCollector = new TraceCollector({
        traceFile,
        enabled: false,
      });

      disabledCollector.record({
        constraintId: 'test',
        level: 'iron_law',
        timestamp: Date.now(),
        result: 'pass',
      });

      const content = fs.readFileSync(traceFile, 'utf-8');
      expect(content).toBe('');
    });

    it('应该追加多条记录', () => {
      collector.record({
        constraintId: 'test1',
        level: 'iron_law',
        timestamp: Date.now(),
        result: 'pass',
      });
      collector.record({
        constraintId: 'test2',
        level: 'guideline',
        timestamp: Date.now(),
        result: 'fail',
      });

      const content = fs.readFileSync(traceFile, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);
    });
  });

  describe('recordPass', () => {
    it('应该记录通过 trace', () => {
      collector.recordPass('no_bypass_checkpoint', 'iron_law');

      const traces = collector.read();
      expect(traces.length).toBe(1);
      expect(traces[0].result).toBe('pass');
    });
  });

  describe('recordFail', () => {
    it('应该记录失败 trace', () => {
      collector.recordFail('no_bypass_checkpoint', 'iron_law');

      const traces = collector.read();
      expect(traces.length).toBe(1);
      expect(traces[0].result).toBe('fail');
    });
  });

  describe('recordBypass', () => {
    it('应该记录绕过 trace', () => {
      collector.recordBypass('no_bypass_checkpoint', 'iron_law', 'Emergency fix');

      const traces = collector.read();
      expect(traces.length).toBe(1);
      expect(traces[0].result).toBe('bypassed');
      expect(traces[0].bypassReason).toBe('Emergency fix');
    });
  });

  describe('read', () => {
    it('应该返回所有 traces', () => {
      collector.record({
        constraintId: 'test1',
        level: 'iron_law',
        timestamp: 1000,
        result: 'pass',
      });
      collector.record({
        constraintId: 'test2',
        level: 'guideline',
        timestamp: 2000,
        result: 'fail',
      });

      const traces = collector.read();
      expect(traces.length).toBe(2);
    });

    it('应该按时间范围过滤', () => {
      collector.record({
        constraintId: 'test1',
        level: 'iron_law',
        timestamp: 1000,
        result: 'pass',
      });
      collector.record({
        constraintId: 'test2',
        level: 'iron_law',
        timestamp: 2000,
        result: 'pass',
      });
      collector.record({
        constraintId: 'test3',
        level: 'iron_law',
        timestamp: 3000,
        result: 'pass',
      });

      const traces = collector.read({
        timeRange: { start: 1500, end: 2500 },
      });
      expect(traces.length).toBe(1);
      expect(traces[0].constraintId).toBe('test2');
    });

    it('应该按约束层级过滤', () => {
      collector.record({
        constraintId: 'test1',
        level: 'iron_law',
        timestamp: 1000,
        result: 'pass',
      });
      collector.record({
        constraintId: 'test2',
        level: 'guideline',
        timestamp: 2000,
        result: 'pass',
      });

      const traces = collector.read({ level: 'iron_law' });
      expect(traces.length).toBe(1);
    });
  });

  describe('readRecent', () => {
    it('应该返回最近 N 小时的 traces', () => {
      const now = Date.now();
      collector.record({
        constraintId: 'old',
        level: 'iron_law',
        timestamp: now - 25 * 60 * 60 * 1000,  // 25 小时前
        result: 'pass',
      });
      collector.record({
        constraintId: 'recent',
        level: 'iron_law',
        timestamp: now - 1 * 60 * 60 * 1000,  // 1 小时前
        result: 'pass',
      });

      const traces = collector.readRecent(24);
      expect(traces.length).toBe(1);
      expect(traces[0].constraintId).toBe('recent');
    });
  });

  describe('readByConstraint', () => {
    it('应该按约束 ID 过滤', () => {
      collector.record({
        constraintId: 'no_bypass',
        level: 'iron_law',
        timestamp: 1000,
        result: 'pass',
      });
      collector.record({
        constraintId: 'other_constraint',
        level: 'guideline',
        timestamp: 2000,
        result: 'pass',
      });

      const traces = collector.readByConstraint('no_bypass');
      expect(traces.length).toBe(1);
      expect(traces[0].constraintId).toBe('no_bypass');
    });
  });

  describe('getStats', () => {
    it('应该返回统计信息', () => {
      collector.record({
        constraintId: 'test1',
        level: 'iron_law',
        timestamp: 1000,
        result: 'pass',
      });
      collector.record({
        constraintId: 'test2',
        level: 'iron_law',
        timestamp: 2000,
        result: 'fail',
      });

      const stats = collector.getStats();

      expect(stats.fileExists).toBe(true);
      expect(stats.totalLines).toBe(2);
    });

    it('空文件应该返回正确信息', () => {
      const emptyCollector = new TraceCollector({
        traceFile: path.join(tempDir, 'empty.log'),
      });

      const stats = emptyCollector.getStats();

      expect(stats.fileExists).toBe(false);
      expect(stats.totalLines).toBe(0);
    });
  });
});