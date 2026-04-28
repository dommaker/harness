/**
 * ContractGate 测试
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ContractGate } from '../gates/contract';
import * as fs from 'fs';
import * as path from 'path';

describe('ContractGate', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-contract');
  const contractFile = path.join(tempDir, 'openapi.yaml');

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
      const gate = new ContractGate({ enabled: false });

      const result = await gate.check({
        projectId: 'test',
        projectPath: tempDir,
      });

      expect(result.passed).toBe(true);
    });

    it('无契约文件时应该通过', async () => {
      const gate = new ContractGate({ enabled: true });

      const result = await gate.check({
        projectId: 'test',
        projectPath: tempDir,
      });

      expect(result.passed).toBe(true);
    });

    it('有契约文件时应该检查', async () => {
      fs.writeFileSync(contractFile, `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /test:
    get:
      summary: Test endpoint
`);

      const gate = new ContractGate({ enabled: true });

      const result = await gate.check({
        projectId: 'test',
        projectPath: tempDir,
      });

      expect(result.gate).toBe('contract');
    });
  });

  describe('配置', () => {
    it('应该支持自定义契约路径', () => {
      const gate = new ContractGate({
        contractPath: 'custom/openapi.yaml',
      });

      expect(gate).toBeDefined();
    });

    it('应该支持严格模式', () => {
      const gate = new ContractGate({
        strict: true,
      });

      expect(gate).toBeDefined();
    });

    it('应该支持允许破坏性变更', () => {
      const gate = new ContractGate({
        allowBreakingChanges: true,
      });

      expect(gate).toBeDefined();
    });
  });
});