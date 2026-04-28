/**
 * SecurityGate 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { SecurityGate } from '../gates/security';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

describe('SecurityGate', () => {
  const tempDir = join(process.cwd(), 'temp-test-security-gate');
  let gate: SecurityGate;

  beforeAll(() => {
    mkdirSync(tempDir, { recursive: true });
    
    // 创建 package.json（无漏洞）
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      dependencies: {},
    }));
    
    gate = new SecurityGate({ enabled: true, severityThreshold: 'high' });
  });

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('scan', () => {
    it('禁用时应该返回通过', async () => {
      const disabledGate = new SecurityGate({ enabled: false });
      
      const result = await disabledGate.scan({
        projectId: 'test-project',
        projectPath: tempDir,
      });
      
      expect(result.passed).toBe(true);
      expect(result.message).toContain('安全门禁已禁用');
    });

    // 跳过：依赖真实 npm audit 结果，需要 mock 重构
    it.skip('应该运行 npm audit', async () => {
      const result = await gate.scan({
        projectId: 'test-project',
        projectPath: tempDir,
      });
      
      expect(result.gate).toBe('security');
      expect(result.details?.scanCommand).toBeDefined();
    });

    it.skip('应该返回漏洞分析', async () => {
      const result = await gate.scan({
        projectId: 'test-project',
        projectPath: tempDir,
      });
      
      expect(result.details).toBeDefined();
      expect(result.details?.critical).toBeDefined();
      expect(result.details?.high).toBeDefined();
    });
  });

  describe('severityThreshold', () => {
    it.skip('high 阈值应该检查 critical + high', async () => {
      const result = await gate.scan({
        projectId: 'test-project',
        projectPath: tempDir,
      });
      
      // 无漏洞时应该通过
      expect(result.passed).toBe(true);
    });

    it('应该能设置严重程度阈值', () => {
      gate.setSeverityThreshold('critical');
      
      const config = gate.getConfig();
      expect(config.severityThreshold).toBe('critical');
    });
  });

  describe('analyzeResult', () => {
    it.skip('应该解析 npm audit JSON 或返回 passed', async () => {
      const result = await gate.scan({
        projectId: 'test-project',
        projectPath: tempDir,
      });
      
      // 无漏洞时可能没有 details.total
      expect(result.passed).toBeDefined();
    });
  });
});
