/**
 * PerformanceGate 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { PerformanceGate } from '../gates/performance';
import * as fs from 'fs';
import * as path from 'path';

describe('PerformanceGate', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-perf-gate');

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

  describe('check', () => {
    it('禁用时应该返回通过', async () => {
      const gate = new PerformanceGate({ enabled: false });

      const result = await gate.check({
        projectId: 'test',
        projectPath: tempDir,
      });

      expect(result.passed).toBe(true);
    });

    it('应该返回检查结果', async () => {
      const gate = new PerformanceGate({
        enabled: true,
        thresholds: {
          maxResponseTime: 1000,
        },
      });

      const result = await gate.check({
        projectId: 'test',
        projectPath: tempDir,
      });

      expect(result.gate).toBe('performance');
    });
  });

  describe('配置', () => {
    it('应该支持自定义阈值', () => {
      const gate = new PerformanceGate({
        thresholds: {
          maxResponseTime: 500,
          maxMemoryUsage: 1000,
        },
      });

      expect(gate).toBeDefined();
    });

    it('应该支持基准测试命令', () => {
      const gate = new PerformanceGate({
        benchmarkCommand: 'npm run benchmark',
      });

      expect(gate).toBeDefined();
    });
  });
});