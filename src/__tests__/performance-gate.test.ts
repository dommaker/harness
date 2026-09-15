/**
 * PerformanceGate 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { PerformanceGate } from '../gates/performance';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('PerformanceGate', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-test-perf-gate-'));
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('check', () => {
    it('应该返回检查结果', async () => {
      const gate = new PerformanceGate({
        thresholds: {
          maxBundleSize: 1000,
        },
      });

      const result = await gate.check({
        projectPath: tempDir,
      });

      expect(result.gate).toBe('performance');
    });
  });

  describe('配置', () => {
    it('应该支持自定义阈值', () => {
      const gate = new PerformanceGate({
        thresholds: {
          minCoverage: 80,
          maxBundleSize: 1000,
        },
      });

      expect(gate).toBeDefined();
    });
  });
});