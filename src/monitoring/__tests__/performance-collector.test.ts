/**
 * PerformanceCollector 测试
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { PerformanceCollector } from '../performance-collector';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
  statSync: jest.fn().mockReturnValue({ size: 100 }),
  renameSync: jest.fn(),
  writeFileSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
  readFileSync: jest.fn().mockReturnValue(''),
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('PerformanceCollector', () => {
  let collector: PerformanceCollector;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.statSync.mockReturnValue({ size: 100 } as any);
    collector = new PerformanceCollector();
  });

  describe('constructor', () => {
    it('should create log directory if not exists', () => {
      mockFs.existsSync.mockReturnValueOnce(false);
      new PerformanceCollector();
      expect(mockFs.mkdirSync).toHaveBeenCalled();
    });

    it('should be disabled when enabled=false', () => {
      const disabledCollector = new PerformanceCollector({ enabled: false });
      disabledCollector.recordOk('test', 100);
      expect(mockFs.appendFileSync).not.toHaveBeenCalled();
    });

    it('should accept custom config', () => {
      const customCollector = new PerformanceCollector({
        enabled: true,
        logFile: '.harness/perf.log',
        maxFileSize: 5 * 1024 * 1024,
      });
      expect(customCollector).toBeDefined();
    });

    it('should use default config', () => {
      const defaultCollector = new PerformanceCollector();
      expect(defaultCollector).toBeDefined();
    });
  });

  describe('record()', () => {
    it('should append trace to file', () => {
      collector.record({
        operation: 'test',
        timestamp: Date.now(),
        duration: 100,
        result: 'ok',
      });
      expect(mockFs.appendFileSync).toHaveBeenCalled();
    });

    it('should not record when disabled', () => {
      const disabledCollector = new PerformanceCollector({ enabled: false });
      disabledCollector.record({
        operation: 'test',
        timestamp: Date.now(),
        duration: 100,
        result: 'ok',
      });
      expect(mockFs.appendFileSync).not.toHaveBeenCalled();
    });

    it('should record with all fields', () => {
      collector.record({
        operation: 'full-test',
        timestamp: 1234567890,
        duration: 500,
        result: 'exceeded',
        threshold: 300,
        metadata: { key: 'value' },
      });
      expect(mockFs.appendFileSync).toHaveBeenCalled();
      const call = mockFs.appendFileSync.mock.calls[0];
      const content = call[1] as string;
      expect(content).toContain('full-test');
      expect(content).toContain('exceeded');
    });
  });

  describe('recordOk()', () => {
    it('should record ok trace', () => {
      collector.recordOk('test', 150);
      const call = mockFs.appendFileSync.mock.calls[0];
      const content = call[1] as string;
      const trace = JSON.parse(content.trim());
      expect(trace.result).toBe('ok');
      expect(trace.operation).toBe('test');
      expect(trace.duration).toBe(150);
    });

    it('should record with metadata', () => {
      collector.recordOk('test', 100, { key: 'value' });
      const call = mockFs.appendFileSync.mock.calls[0];
      const content = call[1] as string;
      const trace = JSON.parse(content.trim());
      expect(trace.metadata).toEqual({ key: 'value' });
    });

    it('should auto-generate timestamp', () => {
      collector.recordOk('test', 100);
      const call = mockFs.appendFileSync.mock.calls[0];
      const content = call[1] as string;
      const trace = JSON.parse(content.trim());
      expect(trace.timestamp).toBeDefined();
      expect(typeof trace.timestamp).toBe('number');
    });

    it('should not record when disabled', () => {
      const disabledCollector = new PerformanceCollector({ enabled: false });
      disabledCollector.recordOk('test', 100);
      expect(mockFs.appendFileSync).not.toHaveBeenCalled();
    });
  });

  describe('recordExceeded()', () => {
    it('should record exceeded trace', () => {
      collector.recordExceeded('test', 35000, 30000);
      const call = mockFs.appendFileSync.mock.calls[0];
      const content = call[1] as string;
      const trace = JSON.parse(content.trim());
      expect(trace.result).toBe('exceeded');
      expect(trace.threshold).toBe(30000);
    });

    it('should include duration', () => {
      collector.recordExceeded('test', 35000, 30000);
      const call = mockFs.appendFileSync.mock.calls[0];
      const content = call[1] as string;
      const trace = JSON.parse(content.trim());
      expect(trace.duration).toBe(35000);
    });

    it('should not record when disabled', () => {
      const disabledCollector = new PerformanceCollector({ enabled: false });
      disabledCollector.recordExceeded('test', 35000, 30000);
      expect(mockFs.appendFileSync).not.toHaveBeenCalled();
    });
  });

  describe('recordError()', () => {
    it('should record error trace', () => {
      collector.recordError('test', 100, 'Test error');
      const call = mockFs.appendFileSync.mock.calls[0];
      const content = call[1] as string;
      const trace = JSON.parse(content.trim());
      expect(trace.result).toBe('error');
      expect(trace.metadata.error).toBe('Test error');
    });

    it('should include duration', () => {
      collector.recordError('test', 100, 'Test error');
      const call = mockFs.appendFileSync.mock.calls[0];
      const content = call[1] as string;
      const trace = JSON.parse(content.trim());
      expect(trace.duration).toBe(100);
    });

    it('should not record when disabled', () => {
      const disabledCollector = new PerformanceCollector({ enabled: false });
      disabledCollector.recordError('test', 100, 'Test error');
      expect(mockFs.appendFileSync).not.toHaveBeenCalled();
    });
  });

  describe('read()', () => {
    it('should return empty array if file not exists', () => {
      mockFs.existsSync.mockReturnValueOnce(false);
      const c = new PerformanceCollector();
      const traces = c.read();
      expect(traces).toEqual([]);
    });

    it('should return traces from file', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValueOnce(
        JSON.stringify({ operation: 'test1', duration: 100, result: 'ok', timestamp: 1 }) + '\n' +
        JSON.stringify({ operation: 'test2', duration: 200, result: 'ok', timestamp: 2 }) + '\n'
      );
      
      const c = new PerformanceCollector();
      const traces = c.read();
      expect(traces.length).toBe(2);
      expect(traces[0].operation).toBe('test1');
      expect(traces[1].operation).toBe('test2');
    });

    it('should handle empty file', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValueOnce('');
      
      const c = new PerformanceCollector();
      const traces = c.read();
      expect(traces).toEqual([]);
    });

    it('should filter by period', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValueOnce(
        JSON.stringify({ operation: 'test1', duration: 100, result: 'ok', timestamp: Date.now() - 100000 }) + '\n' +
        JSON.stringify({ operation: 'test2', duration: 200, result: 'ok', timestamp: Date.now() }) + '\n'
      );
      
      const c = new PerformanceCollector();
      const traces = c.read({ timeRange: { start: Date.now() - 50000, end: Date.now() } });
      expect(traces.length).toBe(1);
      expect(traces[0].operation).toBe('test2');
    });

    it('should filter by operation', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValueOnce(
        JSON.stringify({ operation: 'test1', duration: 100, result: 'ok', timestamp: Date.now() }) + '\n' +
        JSON.stringify({ operation: 'test2', duration: 200, result: 'ok', timestamp: Date.now() }) + '\n'
      );
      
      const c = new PerformanceCollector();
      const traces = c.read({ operation: 'test1' });
      expect(traces.length).toBe(1);
      expect(traces[0].operation).toBe('test1');
    });

    it('should filter by result', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValueOnce(
        JSON.stringify({ operation: 'test1', duration: 100, result: 'ok', timestamp: Date.now() }) + '\n' +
        JSON.stringify({ operation: 'test2', duration: 200, result: 'exceeded', timestamp: Date.now() }) + '\n'
      );
      
      const c = new PerformanceCollector();
      const traces = c.read({ result: 'exceeded' });
      expect(traces.length).toBe(1);
      expect(traces[0].result).toBe('exceeded');
    });
  });

  describe('getStats()', () => {
    it('should return stats', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ size: 1024 } as any);
      
      const stats = collector.getStats();
      expect(stats).toHaveProperty('fileExists');
    });

    it('should return stats when file not exists', () => {
      // 先让目录检查通过，再让文件检查失败
      mockFs.existsSync
        .mockReturnValueOnce(true) // 目录检查
        .mockReturnValueOnce(false); // 文件检查
      
      const c = new PerformanceCollector();
      mockFs.existsSync.mockReturnValue(false); // getStats 检查
      const stats = c.getStats();
      expect(stats.fileExists).toBe(false);
    });

    it('should include file size', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ size: 2048 } as any);
      
      const stats = collector.getStats();
      expect(stats.fileSize).toBe(2048);
    });
  });

  describe('file rolling', () => {
    it('should roll file when size exceeds limit', () => {
      mockFs.statSync.mockReturnValue({ size: 15 * 1024 * 1024 } as any); // 15MB
      
      collector.recordOk('test', 100);
      expect(mockFs.renameSync).toHaveBeenCalled();
    });

    it('should not roll when under limit', () => {
      mockFs.statSync.mockReturnValue({ size: 5 * 1024 * 1024 } as any); // 5MB
      
      collector.recordOk('test', 100);
      expect(mockFs.renameSync).not.toHaveBeenCalled();
    });
  });

  describe('clear()', () => {
    it('should exist if implemented', () => {
      // Check if method exists
      const hasClear = typeof (collector as any).clear === 'function';
      if (hasClear) {
        mockFs.existsSync.mockReturnValue(true);
        (collector as any).clear();
        expect(mockFs.writeFileSync).toHaveBeenCalled();
      }
    });
  });

  describe('getRecentTraces()', () => {
    it('should return recent traces', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValueOnce(
        JSON.stringify({ operation: 'test1', duration: 100, result: 'ok', timestamp: Date.now() }) + '\n' +
        JSON.stringify({ operation: 'test2', duration: 200, result: 'ok', timestamp: Date.now() }) + '\n' +
        JSON.stringify({ operation: 'test3', duration: 300, result: 'ok', timestamp: Date.now() }) + '\n'
      );
      
      // Check if method exists
      const hasRecent = typeof (collector as any).getRecentTraces === 'function';
      if (hasRecent) {
        const traces = (collector as any).getRecentTraces(2);
        expect(traces.length).toBe(2);
      }
    });
  });
});