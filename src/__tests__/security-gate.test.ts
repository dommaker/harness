/**
 * SecurityGate 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { SecurityGate } from '../gates/security';
import { rmSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SecurityGate', () => {
  let tempDir: string;
  let gate: SecurityGate;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'temp-test-security-gate-'));
    
    // 创建 package.json（无漏洞）
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      dependencies: {},
    }));
    
    gate = new SecurityGate({ severityThreshold: 'high' });
  });

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('scan', () => {
    // 跳过：依赖真实 npm audit 结果，需要 mock 重构
    it.skip('应该运行 npm audit', async () => {
      const result = await gate.scan({
        projectPath: tempDir,
      });
      
      expect(result.gate).toBe('security');
      expect(result.details?.scanCommand).toBeDefined();
    });

    it.skip('应该返回漏洞分析', async () => {
      const result = await gate.scan({
        projectPath: tempDir,
      });
      
      expect(result.details).toBeDefined();
      expect(result.details?.critical).toBeDefined();
      expect(result.details?.high).toBeDefined();
    });
  });

  describe('analyzeResult', () => {
    it.skip('应该解析 npm audit JSON 或返回 passed', async () => {
      const result = await gate.scan({
        projectPath: tempDir,
      });
      
      // 无漏洞时可能没有 details.total
      expect(result.passed).toBeDefined();
    });
  });
});
