/**
 * PerformanceGate 测试
 */

import { PerformanceGate } from '../performance';
import { exec } from 'child_process';
import * as fs from 'fs/promises';

// Mock dependencies
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  readdir: jest.fn(),
  stat: jest.fn(),
}));

const mockExec = exec as unknown as jest.Mock;
const mockFs = fs as jest.Mocked<typeof fs>;

describe('PerformanceGate', () => {
  let gate: PerformanceGate;
  const baseContext = {
    projectPath: '/test/project',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    gate = new PerformanceGate();
  });

  describe('constructor', () => {
    it('should use default config', async () => {
      // 缺省 thresholds={}：无阈值时检查直接通过
      const result = await gate.check(baseContext);
      expect(result.passed).toBe(true);
    });

    it('should accept custom config', () => {
      const customGate = new PerformanceGate({
        coverageTimeout: 60000,
      });
      expect(customGate).toBeDefined();
    });
  });

  describe('check()', () => {
    it('should pass when no thresholds defined', async () => {
      const result = await gate.check(baseContext);

      expect(result.passed).toBe(true);
    });

    it('should pass when all metrics meet thresholds', async () => {
      const strictGate = new PerformanceGate({
        thresholds: {
          minCoverage: 50,
          maxBundleSize: 1000,
        },
      });

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, { stdout: '', stderr: '' });
      });

      mockFs.readFile.mockResolvedValueOnce(
        JSON.stringify({ total: { lines: { pct: 80 } } })
      );

      mockFs.readdir.mockResolvedValueOnce(['bundle.js'] as any);
      mockFs.stat.mockResolvedValueOnce({ isFile: () => true, size: 500 * 1024 } as any);

      const result = await strictGate.check(baseContext);

      expect(result.passed).toBe(true);
    });

    it('should fail when coverage below threshold', async () => {
      const strictGate = new PerformanceGate({
        thresholds: { minCoverage: 80 },
      });

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, { stdout: '', stderr: '' });
      });

      mockFs.readFile.mockResolvedValueOnce(
        JSON.stringify({ total: { lines: { pct: 50 } } })
      );

      const result = await strictGate.check(baseContext);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('覆盖率');
    });

    it('should fail when bundle size exceeds threshold', async () => {
      const strictGate = new PerformanceGate({
        thresholds: { maxBundleSize: 100 },
      });

      mockFs.readdir.mockResolvedValueOnce(['bundle.js'] as any);
      mockFs.stat.mockResolvedValueOnce({ isFile: () => true, size: 500 * 1024 } as any);

      const result = await strictGate.check(baseContext);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('打包大小');
    });

    it('should use thresholds from context', async () => {
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, { stdout: '', stderr: '' });
      });

      mockFs.readFile.mockResolvedValueOnce(
        JSON.stringify({ total: { lines: { pct: 90 } } })
      );

      const result = await gate.check({
        ...baseContext,
        performanceThresholds: { minCoverage: 80 },
      });

      expect(result.passed).toBe(true);
    });

    it('should include warnings for errors', async () => {
      const strictGate = new PerformanceGate({
        thresholds: { minCoverage: 80 },
      });

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(new Error('Test failed'), null);
      });

      mockFs.readFile.mockRejectedValueOnce({ code: 'ENOENT' });

      const result = await strictGate.check(baseContext);

      expect(result.message).toContain('警告');
    });

    it('should include metrics in result', async () => {
      const strictGate = new PerformanceGate({
        thresholds: { maxBundleSize: 1000 },
      });

      mockFs.readdir.mockResolvedValueOnce(['bundle.js'] as any);
      mockFs.stat.mockResolvedValueOnce({ isFile: () => true, size: 500 * 1024 } as any);

      const result = await strictGate.check(baseContext);

      expect(result.details?.metrics).toBeDefined();
      expect((result.details?.metrics as { bundleSize?: number }).bundleSize).toBeDefined();
    });
  });

  describe('collectCoverage()', () => {
    it('should handle coverage test timeout', async () => {
      const strictGate = new PerformanceGate({
        thresholds: { minCoverage: 80 },
        coverageTimeout: 100,
      });

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        const error: any = new Error('Timeout');
        error.killed = true;
        callback(error, null);
      });

      const result = await strictGate.check(baseContext);

      expect(result.message).toContain('超时');
    });

    it('should handle missing coverage report', async () => {
      const strictGate = new PerformanceGate({
        thresholds: { minCoverage: 80 },
      });

      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(null, { stdout: '', stderr: '' });
      });

      mockFs.readFile.mockRejectedValueOnce({ code: 'ENOENT' });

      const result = await strictGate.check(baseContext);

      expect(result.message).toContain('未找到覆盖率报告');
    });
  });

  describe('collectBundleSize()', () => {
    it('should handle missing dist directory', async () => {
      const strictGate = new PerformanceGate({
        thresholds: { maxBundleSize: 1000 },
      });

      mockFs.readdir.mockRejectedValueOnce({ code: 'ENOENT' });

      const result = await strictGate.check(baseContext);

      expect(result.message).toContain('未找到 dist 目录');
    });

    it('should sum all files in dist', async () => {
      const strictGate = new PerformanceGate({
        thresholds: { maxBundleSize: 1000 },
      });

      mockFs.readdir.mockResolvedValueOnce(['a.js', 'b.js'] as any);
      mockFs.stat
        .mockResolvedValueOnce({ isFile: () => true, size: 200 * 1024 } as any)
        .mockResolvedValueOnce({ isFile: () => true, size: 300 * 1024 } as any);

      const result = await strictGate.check(baseContext);

      expect((result.details?.metrics as { bundleSize?: number }).bundleSize).toBe(500); // 200KB + 300KB
    });

    it('should skip directories', async () => {
      const strictGate = new PerformanceGate({
        thresholds: { maxBundleSize: 1000 },
      });

      mockFs.readdir.mockResolvedValueOnce(['file.js', 'nested'] as any);
      mockFs.stat
        .mockResolvedValueOnce({ isFile: () => true, size: 100 * 1024 } as any)
        .mockResolvedValueOnce({ isFile: () => false, size: 0 } as any);

      const result = await strictGate.check(baseContext);

      expect((result.details?.metrics as { bundleSize?: number }).bundleSize).toBe(100);
    });
  });

  describe('timing', () => {
    it('should include duration in result', async () => {
      const result = await gate.check(baseContext);

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should include timestamp', async () => {
      const result = await gate.check(baseContext);

      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).not.toBeNaN();
    });
  });
});
