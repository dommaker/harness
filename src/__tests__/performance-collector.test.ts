/**
 * PerformanceCollector 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { PerformanceCollector } from '../monitoring/performance-collector';
import * as fs from 'fs';
import * as path from 'path';

describe('PerformanceCollector', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-perf');
  const logFile = path.join(tempDir, 'performance.log');
  let collector: PerformanceCollector;

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
    fs.writeFileSync(logFile, '');
    collector = new PerformanceCollector({ logFile, enabled: true });
  });

  describe('record', () => {
    it('应该记录性能数据', () => {
      collector.record({
        operation: 'test_op',
        timestamp: Date.now(),
        duration: 100,
        result: 'ok',
      });

      const content = fs.readFileSync(logFile, 'utf-8');
      expect(content).toContain('test_op');
      expect(content).toContain('ok');
    });

    it('禁用时应该不记录', () => {
      const disabledCollector = new PerformanceCollector({
        logFile,
        enabled: false,
      });

      disabledCollector.record({
        operation: 'test',
        timestamp: Date.now(),
        duration: 100,
        result: 'ok',
      });

      const content = fs.readFileSync(logFile, 'utf-8');
      expect(content).toBe('');
    });
  });

  describe('recordOk', () => {
    it('应该记录正常执行', () => {
      collector.recordOk('extract', 150);

      const content = fs.readFileSync(logFile, 'utf-8');
      expect(content).toContain('extract');
      expect(content).toContain('150');
      expect(content).toContain('ok');
    });

    it('应该支持元数据', () => {
      collector.recordOk('extract', 150, { files: 10 });

      const content = fs.readFileSync(logFile, 'utf-8');
      expect(content).toContain('files');
    });
  });

  describe('recordExceeded', () => {
    it('应该记录超阈值执行', () => {
      collector.recordExceeded('invokeAgent', 35000, 30000);

      const content = fs.readFileSync(logFile, 'utf-8');
      expect(content).toContain('invokeAgent');
      expect(content).toContain('exceeded');
      expect(content).toContain('35000');
    });
  });

  describe('read', () => {
    it('应该读取性能数据', () => {
      collector.recordOk('op1', 100);
      collector.recordOk('op2', 200);

      const traces = collector.read();
      expect(traces.length).toBe(2);
    });

    it('空文件应该返回空数组', () => {
      fs.writeFileSync(logFile, '');
      const traces = collector.read();
      expect(traces).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('应该返回统计信息', () => {
      collector.recordOk('op1', 100);
      collector.recordOk('op2', 200);
      collector.recordExceeded('op3', 500, 400);

      const stats = collector.getStats();

      expect(stats.totalRecords).toBe(3);
    });

    it('应该正确读取数据', () => {
      collector.recordOk('op1', 100);
      collector.recordOk('op2', 200);

      const traces = collector.read();

      expect(traces.length).toBe(2);
    });
  });
});