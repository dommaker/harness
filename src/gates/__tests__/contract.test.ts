/**
 * ContractGate 测试（门禁规则：每个门禁必须有测试文件）
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ContractGate } from '../contract';

const VALID_SPEC = [
  'openapi: 3.0.0',
  'info:',
  '  title: Test API',
  '  version: 1.0.0',
  'paths:',
  '  /users:',
  '    get: {}',
].join('\n');

const INVALID_SPEC = ['info:', '  title: Test API', 'paths:', '  /users:', '    get: {}'].join('\n');

describe('ContractGate', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-gate-contract-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('有效 OpenAPI → check 通过', async () => {
    fs.writeFileSync(path.join(dir, 'openapi.yaml'), VALID_SPEC);
    const result = await new ContractGate().check({ projectId: 'p', projectPath: dir });
    expect(result.passed).toBe(true);
  });

  it('缺 openapi 版本 → check 失败', async () => {
    fs.writeFileSync(path.join(dir, 'openapi.yaml'), INVALID_SPEC);
    const result = await new ContractGate().check({ projectId: 'p', projectPath: dir });
    expect(result.passed).toBe(false);
  });

  it('契约文件缺失 → 跳过（passed）', async () => {
    const result = await new ContractGate().check({ projectId: 'p', projectPath: dir });
    expect(result.passed).toBe(true);
    expect(result.message).toContain('未找到契约文件');
  });

  describe('统一接口 evaluate', () => {
    it('有效契约 → abstain（冻结决策）', async () => {
      fs.writeFileSync(path.join(dir, 'openapi.yaml'), VALID_SPEC);
      const decision = await new ContractGate().evaluate({ projectId: 'p', projectPath: dir });
      expect(decision.status).toBe('abstain');
      expect(decision.result.gate).toBe('contract');
      expect(Object.isFrozen(decision)).toBe(true);
    });

    it('无效契约 → deny', async () => {
      fs.writeFileSync(path.join(dir, 'openapi.yaml'), INVALID_SPEC);
      const decision = await new ContractGate().evaluate({ projectId: 'p', projectPath: dir });
      expect(decision.status).toBe('deny');
      expect(decision.result.passed).toBe(false);
    });

    it('id/order 字段齐备', () => {
      const gate = new ContractGate();
      expect(gate.id).toBe('contract');
      expect(gate.order).toBe(0);
    });
  });
});
