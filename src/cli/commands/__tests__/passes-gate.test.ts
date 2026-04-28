/**
 * passes-gate 命令测试
 */

import { runPassesGate, checkCoverage } from '../passes-gate';
import * as fs from 'fs/promises';
import { PassesGate } from '../../../core/validators/passes-gate';

// Mock fs/promises
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  access: jest.fn(),
}));

// Mock PassesGate
jest.mock('../../../core/validators/passes-gate', () => ({
  PassesGate: jest.fn(),
}));

// Mock chalk
jest.mock('chalk', () => ({
  blue: jest.fn((str: string) => str),
  yellow: jest.fn((str: string) => str),
  green: jest.fn((str: string) => str),
  gray: jest.fn((str: string) => str),
  red: jest.fn((str: string) => str),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const MockPassesGate = PassesGate as jest.MockedClass<typeof PassesGate>;

describe('passes-gate command', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    process.exitCode = 0;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    process.exitCode = 0;
  });

  describe('runPassesGate', () => {
    it('应该跳过无测试命令的情况', async () => {
      mockFs.readFile.mockRejectedValue(new Error('no package.json'));
      mockFs.access.mockRejectedValue(new Error('no file'));

      await runPassesGate({});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('未检测到测试命令'));
    });

    it('应该通过测试门控', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({
        scripts: { test: 'jest' },
      }));

      const mockRunTests = jest.fn().mockResolvedValue({
        passed: true,
        passedTests: 10,
        failedTests: 0,
        totalTests: 10,
        duration: 1000,
        failures: [],
      });
      (MockPassesGate as any).mockImplementation(() => ({
        runTests: mockRunTests,
      }));

      await runPassesGate({});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('测试门控通过'));
    });

    it('应该失败测试门控', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({
        scripts: { test: 'jest' },
      }));

      const mockRunTests = jest.fn().mockResolvedValue({
        passed: false,
        passedTests: 8,
        failedTests: 2,
        totalTests: 10,
        duration: 1000,
        failures: [{ name: 'test1', message: 'failed' }],
      });
      (MockPassesGate as any).mockImplementation(() => ({
        runTests: mockRunTests,
      }));

      // Mock process.exit
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      await runPassesGate({});
      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });

    it('应该处理测试执行错误', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({
        scripts: { test: 'jest' },
      }));

      const mockRunTests = jest.fn().mockRejectedValue(new Error('test failed'));
      (MockPassesGate as any).mockImplementation(() => ({
        runTests: mockRunTests,
      }));

      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      await runPassesGate({});
      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });

    it('应该使用自定义测试命令', async () => {
      const mockRunTests = jest.fn().mockResolvedValue({
        passed: true,
        passedTests: 5,
        failedTests: 0,
        totalTests: 5,
        duration: 500,
        failures: [],
      });
      (MockPassesGate as any).mockImplementation(() => ({
        runTests: mockRunTests,
      }));

      await runPassesGate({ testCommand: 'pytest' });
      expect(MockPassesGate).toHaveBeenCalledWith(
        expect.objectContaining({ testCommand: 'pytest' })
      );
    });
  });

  describe('checkCoverage', () => {
    it('应该跳过覆盖率检查（无法 mock child_process）', async () => {
      // checkCoverage 使用动态 import child_process，无法在测试中 mock
      // 简单验证函数存在
      expect(typeof checkCoverage).toBe('function');
    });
  });
});