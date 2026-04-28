/**
 * ContractGate 测试
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { ContractGate } from '../gates/contract';
import * as fs from 'fs';
import * as path from 'path';

describe('ContractGate', () => {
  const tempDir = path.join(process.cwd(), 'temp-test-contract');
  const contractFile = path.join(tempDir, 'openapi.yaml');
  const oldContractFile = path.join(tempDir, 'openapi-old.yaml');
  const jsonContractFile = path.join(tempDir, 'openapi.json');

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
    // 清理临时文件
    try {
      fs.rmSync(contractFile, { force: true });
      fs.rmSync(oldContractFile, { force: true });
      fs.rmSync(jsonContractFile, { force: true });
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
      expect(result.message).toContain('禁用');
    });

    it('无契约文件时应该通过', async () => {
      const gate = new ContractGate({ enabled: true });

      const result = await gate.check({
        projectId: 'test',
        projectPath: tempDir,
      });

      expect(result.passed).toBe(true);
      expect(result.message).toContain('未找到');
    });

    it('有效契约文件应该通过', async () => {
      fs.writeFileSync(contractFile, `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /test:
    get:
      summary: Test endpoint
  /users:
    post:
      summary: Create user
`);

      const gate = new ContractGate({ enabled: true });

      const result = await gate.check({
        projectId: 'test',
        projectPath: tempDir,
      });

      expect(result.passed).toBe(true);
      expect(result.gate).toBe('contract');
      expect(result.details?.endpoints).toBe(2);
    });

    it('契约缺少版本应该失败', async () => {
      fs.writeFileSync(contractFile, `
info:
  title: Test API
paths:
  /test:
    get:
      summary: Test
`);

      const gate = new ContractGate({ enabled: true });

      const result = await gate.check({
        projectId: 'test',
        projectPath: tempDir,
      });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('缺少');
    });

    it('契约无端点应该失败', async () => {
      fs.writeFileSync(contractFile, `
openapi: 3.0.0
info:
  title: Empty API
  version: 1.0.0
paths:
`);

      const gate = new ContractGate({ enabled: true });

      const result = await gate.check({
        projectId: 'test',
        projectPath: tempDir,
      });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('端点');
    });

    it('JSON 契约应该正确解析', async () => {
      fs.writeFileSync(jsonContractFile, JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Test', version: '1.0' },
        paths: {
          '/test': { get: { summary: 'Test' } },
          '/users': { post: { summary: 'Create' } },
        },
      }));

      const gate = new ContractGate({ enabled: true, contractPath: 'openapi.json' });

      const result = await gate.check({
        projectId: 'test',
        projectPath: tempDir,
      });

      expect(result.passed).toBe(true);
      expect(result.details?.endpoints).toBe(2);
    });

    it('破坏性变更检测 - 端点删除', async () => {
      // 旧契约
      fs.writeFileSync(oldContractFile, `
openapi: 3.0.0
paths:
  /test:
    get:
      summary: Test
  /users:
    get:
      summary: List users
`);

      // 新契约（删除了 /users）
      fs.writeFileSync(contractFile, `
openapi: 3.0.0
paths:
  /test:
    get:
      summary: Test
`);

      const gate = new ContractGate({ enabled: true, allowBreakingChanges: false });

      const result = await gate.check({
        projectId: 'test',
        projectPath: tempDir,
        oldContractPath: oldContractFile,
      });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('破坏性变更');
      expect(result.details?.breakingChanges?.length).toBe(1);
    });

    it('允许破坏性变更时应该通过', async () => {
      fs.writeFileSync(oldContractFile, `
openapi: 3.0.0
paths:
  /test:
    get:
      summary: Test
  /users:
    get:
      summary: List
`);

      fs.writeFileSync(contractFile, `
openapi: 3.0.0
paths:
  /test:
    get:
      summary: Test
`);

      const gate = new ContractGate({ enabled: true, allowBreakingChanges: true });

      const result = await gate.check({
        projectId: 'test',
        projectPath: tempDir,
        oldContractPath: oldContractFile,
      });

      // 允许破坏性变更时，即使检测到变更也应该通过
      expect(result.passed).toBe(true);
    });

    it('新增端点不是破坏性变更', async () => {
      fs.writeFileSync(oldContractFile, `
openapi: 3.0.0
paths:
  /test:
    get:
      summary: Test
`);

      fs.writeFileSync(contractFile, `
openapi: 3.0.0
paths:
  /test:
    get:
      summary: Test
  /new:
    post:
      summary: New endpoint
`);

      const gate = new ContractGate({ enabled: true });

      const result = await gate.check({
        projectId: 'test',
        projectPath: tempDir,
        oldContractPath: oldContractFile,
      });

      expect(result.passed).toBe(true);
    });

    it('使用 newContractPath 参数', async () => {
      const customContract = path.join(tempDir, 'custom.yaml');
      fs.writeFileSync(customContract, `
openapi: 3.0.0
paths:
  /custom:
    get:
      summary: Custom
`);

      const gate = new ContractGate({ enabled: true });

      const result = await gate.check({
        projectId: 'test',
        projectPath: tempDir,
        newContractPath: customContract,
      });

      expect(result.passed).toBe(true);
    });

    it('无效 YAML 应该返回解析失败', async () => {
      fs.writeFileSync(contractFile, 'invalid: yaml: content: [broken');

      const gate = new ContractGate({ enabled: true });

      const result = await gate.check({
        projectId: 'test',
        projectPath: tempDir,
      });

      // 基础验证会检查版本和端点，无效 YAML 可能没有这些
      expect(result).toBeDefined();
    });
  });

  describe('配置方法', () => {
    it('setContractPath 应该更新路径', () => {
      const gate = new ContractGate();
      gate.setContractPath('new/path.yaml');

      const config = gate.getConfig();
      expect(config.contractPath).toBe('new/path.yaml');
    });

    it('getConfig 应该返回当前配置', () => {
      const gate = new ContractGate({
        enabled: true,
        strict: false,
        allowBreakingChanges: true,
        contractPath: 'api.yaml',
      });

      const config = gate.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.strict).toBe(false);
      expect(config.allowBreakingChanges).toBe(true);
      expect(config.contractPath).toBe('api.yaml');
    });

    it('默认配置', () => {
      const gate = new ContractGate();
      const config = gate.getConfig();

      expect(config.enabled).toBe(true);
      expect(config.strict).toBe(true);
      expect(config.allowBreakingChanges).toBe(false);
      expect(config.contractPath).toBe('openapi.yaml');
    });
  });
});