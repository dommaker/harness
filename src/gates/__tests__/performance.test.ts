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
    projectId: 'test-project',
    projectPath: '/test/project',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    gate = new PerformanceGate();
  });

  describe('constructor', () => {
    it('should use default config', () => {
      const defaultGate = new PerformanceGate();
      const config = defaultGate.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.warmupRuns).toBe(2);
      expect(config.measureRuns).toBe(5);
    });

    it('should accept custom config', () => {
      const customGate = new PerformanceGate({
        enabled: false,
        warmupRuns: 3,
        measureRuns: 10,
        coverageTimeout: 60000,
      });
      const config = customGate.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.warmupRuns).toBe(3);
      expect(config.measureRuns).toBe(10);
      expect(config.coverageTimeout).toBe(60000);
    });
  });

  describe('check()', () => {
    it('should pass when gate is disabled', async () => {
      const disabledGate = new PerformanceGate({ enabled: false });

      const result = await disabledGate.check(baseContext);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('已禁用');
    });

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
        thresholds: {
          maxResponseTime: 1000,
          maxMemoryUsage: 500,
        },
      });

      const result = await strictGate.check(baseContext);

      expect(result.details?.metrics).toBeDefined();
      expect(result.details?.metrics.responseTime).toBeDefined();
      expect(result.details?.metrics.memoryUsage).toBeDefined();
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

      expect(result.details?.metrics.bundleSize).toBe(500); // 200KB + 300KB
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

      expect(result.details?.metrics.bundleSize).toBe(100);
    });
  });

  describe('runBenchmark()', () => {
    it('should return benchmark results', async () => {
      mockExec.mockImplementation((cmd, opts, callback) => {
        callback(null, { stdout: '', stderr: '' });
      });

      const result = await gate.runBenchmark(baseContext);

      expect(result.avgResponseTime).toBeGreaterThanOrEqual(0);
      expect(result.avgMemoryUsage).toBeGreaterThanOrEqual(0);
    });

    it('should run warmup and measure runs', async () => {
      const customGate = new PerformanceGate({
        warmupRuns: 1,
        measureRuns: 2,
        benchmarkCommand: 'npm run bench',
      });

      // Each exec call should succeed
      mockExec.mockImplementation((cmd, opts, callback) => {
        callback(null, { stdout: '', stderr: '' });
      });

      await customGate.runBenchmark(baseContext);

      // warmupRuns + measureRuns = 3 calls
      expect(mockExec).toHaveBeenCalledTimes(3);
    });

    it('should use custom benchmark command', async () => {
      const customGate = new PerformanceGate({
        benchmarkCommand: 'npm run benchmark',
      });

      mockExec.mockImplementation((cmd, opts, callback) => {
        expect(cmd).toContain('npm run benchmark');
        callback(null, { stdout: '', stderr: '' });
      });

      await customGate.runBenchmark(baseContext);
    });

    it('should handle benchmark error', async () => {
      const errorGate = new PerformanceGate({
        warmupRuns: 1,
        benchmarkCommand: 'npm run bench',
      });

      // Mock exec to fail
      mockExec.mockImplementationOnce((cmd, opts, callback) => {
        callback(new Error('Benchmark failed'), null);
      });

      const result = await errorGate.runBenchmark(baseContext);

      expect(result.error).toContain('failed');
    });
  });

  describe('setThresholds()', () => {
    it('should update thresholds', () => {
      gate.setThresholds({
        minCoverage: 90,
        maxBundleSize: 500,
      });

      const config = gate.getConfig();
      expect(config.thresholds.minCoverage).toBe(90);
      expect(config.thresholds.maxBundleSize).toBe(500);
    });

    it('should merge with existing thresholds', () => {
      const customGate = new PerformanceGate({
        thresholds: { minCoverage: 50 },
      });

      customGate.setThresholds({ maxBundleSize: 1000 });

      const config = customGate.getConfig();
      expect(config.thresholds.minCoverage).toBe(50);
      expect(config.thresholds.maxBundleSize).toBe(1000);
    });
  });

  describe('setTimeouts()', () => {
    it('should update timeouts', () => {
      gate.setTimeouts({
        coverage: 30000,
        benchmark: 20000,
      });

      const config = gate.getConfig();
      expect(config.coverageTimeout).toBe(30000);
      expect(config.benchmarkTimeout).toBe(20000);
    });
  });

  describe('getConfig()', () => {
    it('should return copy of config', () => {
      const config1 = gate.getConfig();
      const config2 = gate.getConfig();
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
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
