/**
 * contract 命令测试
 */

import { contract, validateSchema } from '../contract';
import { captureIO, type CapturingIO } from '../../command-contract';
import * as fs from 'fs/promises';
import { ContractGate } from '../../../gates/contract';

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  access: jest.fn(),
}));

jest.mock('../../../gates/contract', () => ({
  ContractGate: jest.fn().mockImplementation(() => ({
    check: jest.fn(),
  })),
}));

jest.mock('js-yaml', () => ({
  load: jest.fn(),
}));

jest.mock('chalk', () => ({
  blue: jest.fn((s: string) => s),
  green: jest.fn((s: string) => s),
  red: jest.fn((s: string) => s),
  yellow: jest.fn((s: string) => s),
  gray: jest.fn((s: string) => s),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const MockGate = ContractGate as jest.MockedClass<typeof ContractGate>;
const yaml = require('js-yaml');

describe('contract command', () => {
  let io: CapturingIO;

  beforeEach(() => {

    io = captureIO();
    jest.clearAllMocks();
  });

  describe('contract', () => {
    it('should print success when check passes', async () => {
      mockFs.access.mockResolvedValue(undefined);
      const mockCheck = jest.fn().mockResolvedValue({
        passed: true,
        message: 'ok',
        details: { endpoints: 10, breakingChanges: false },
      });
      MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

      const result = await contract({}, io);

      expect(io.outText()).toContain('契约门控检查通过');
      expect(result.kind).toBe('ok');
    });

    it('should exit 1 when file does not exist', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));

      const result = await contract({}, io);

      expect(io.outText()).toContain('契约文件不存在');
      expect(result.kind).toBe('fail');
    });

    it('should print failure and exit 1 when check fails', async () => {
      mockFs.access.mockResolvedValue(undefined);
      const mockCheck = jest.fn().mockResolvedValue({
        passed: false,
        message: 'validation errors',
        details: {
          errors: ['missing field X', 'invalid type Y'],
          breakingChanges: [{ type: 'removed', path: '/api/v1/users' }],
        },
      });
      MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

      const result = await contract({}, io);

      expect(io.outText()).toContain('契约门控检查失败');
      expect(result.kind).toBe('fail');
    });

    it('should handle thrown errors and exit 1', async () => {
      mockFs.access.mockResolvedValue(undefined);
      const mockCheck = jest.fn().mockRejectedValue(new Error('gate error'));
      MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

      const result = await contract({}, io);

      expect(io.outText()).toContain('契约门控检查出错');
      expect(result.kind).toBe('fail');
    });
  });

  describe('validateSchema', () => {
    it('should validate a valid schema', async () => {
      mockFs.readFile.mockResolvedValue('yaml-content');
      yaml.load.mockReturnValue({
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: { '/users': {} },
      });

      await validateSchema({}, io);

      expect(io.outText()).toContain('Schema 验证通过');
    });

    it('should report missing fields', async () => {
      mockFs.readFile.mockResolvedValue('{}');
      yaml.load.mockReturnValue({});

      const result = await validateSchema({}, io);

      expect(io.outText()).toContain('Schema 验证失败');
      expect(result.kind).toBe('fail');
    });

    it('should report YAML parse errors', async () => {
      mockFs.readFile.mockResolvedValue('invalid: yaml: content:');
      yaml.load.mockImplementation(() => { throw new Error('parse error'); });

      const result = await validateSchema({}, io);

      expect(io.outText()).toContain('YAML 解析错误');
      expect(result.kind).toBe('fail');
    });

    it('should handle file read errors', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));

      const result = await validateSchema({}, io);

      expect(io.outText()).toContain('验证失败');
      expect(result.kind).toBe('fail');
    });
  });
});
