/**
 * contract 命令测试
 */

import { contract, validateSchema } from '../contract';
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
  let consoleSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    process.exitCode = 0;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
    process.exitCode = 0;
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

      await contract({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('契约门控检查通过'));
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('should exit 1 when file does not exist', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));

      await contract({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('契约文件不存在'));
      expect(exitSpy).toHaveBeenCalledWith(1);
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

      await contract({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('契约门控检查失败'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle thrown errors and exit 1', async () => {
      mockFs.access.mockResolvedValue(undefined);
      const mockCheck = jest.fn().mockRejectedValue(new Error('gate error'));
      MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

      await contract({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('契约门控检查出错'));
      expect(exitSpy).toHaveBeenCalledWith(1);
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

      await validateSchema({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Schema 验证通过'));
    });

    it('should report missing fields', async () => {
      mockFs.readFile.mockResolvedValue('{}');
      yaml.load.mockReturnValue({});

      await validateSchema({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Schema 验证失败'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should report YAML parse errors', async () => {
      mockFs.readFile.mockResolvedValue('invalid: yaml: content:');
      yaml.load.mockImplementation(() => { throw new Error('parse error'); });

      await validateSchema({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('YAML 解析错误'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle file read errors', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));

      await validateSchema({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('验证失败'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
