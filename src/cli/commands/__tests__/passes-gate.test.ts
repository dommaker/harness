/**
 * passes-gate 命令测试
 */

import { runPassesGate, checkCoverage } from '../passes-gate';
import * as fs from 'fs/promises';
import { PassesGate } from '../../../core/validators/passes-gate';
import { execAsync } from '../../../utils/exec';

// Mock fs/promises
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  access: jest.fn(),
}));

// Mock execAsync
jest.mock('../../../utils/exec', () => ({
  execAsync: jest.fn(),
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
const mockExecAsync = execAsync as jest.MockedFunction<typeof execAsync>;

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
    it('应该返回 true 当覆盖率达标', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      mockFs.readFile.mockResolvedValue(JSON.stringify({
        total: { lines: { pct: 85 } },
      }));

      const result = await checkCoverage('/project', 80);
      expect(result).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('覆盖率达标'));
    });

    it('应该返回 false 当覆盖率不足', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      mockFs.readFile.mockResolvedValue(JSON.stringify({
        total: { lines: { pct: 60 } },
      }));

      const result = await checkCoverage('/project', 80);
      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('覆盖率不足'));
    });

    it('应该返回 true 当执行出错时', async () => {
      mockExecAsync.mockRejectedValue(new Error('command failed'));

      const result = await checkCoverage('/project');
      expect(result).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('无法获取覆盖率信息'));
    });

    it('应该使用默认阈值 80', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      mockFs.readFile.mockResolvedValue(JSON.stringify({
        total: { lines: { pct: 80 } },
      }));

      const result = await checkCoverage('/project');
      expect(result).toBe(true);
    });

    it('应该处理 coverage.total 为 undefined', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      mockFs.readFile.mockResolvedValue(JSON.stringify({}));

      const result = await checkCoverage('/project', 80);
      expect(result).toBe(false);
    });
  });

  describe('detectTestCommand', () => {
    it('应该检测 pytest 项目', async () => {
      // package.json 不存在
      mockFs.readFile.mockRejectedValue(new Error('no file'));
      // pytest.ini 存在
      mockFs.access
        .mockResolvedValueOnce(undefined) // pytest.ini
        .mockRejectedValueOnce(new Error('no file')); // go.mod

      const mockRunTests = jest.fn().mockResolvedValue({
        passed: true, passedTests: 5, failedTests: 0, totalTests: 5, duration: 500, failures: [],
      });
      (MockPassesGate as any).mockImplementation(() => ({ runTests: mockRunTests }));

      await runPassesGate({});
      expect(MockPassesGate).toHaveBeenCalledWith(expect.objectContaining({ testCommand: 'pytest' }));
    });

    it('应该检测 Go 项目', async () => {
      mockFs.readFile.mockRejectedValue(new Error('no file'));
      // Reset access mock to avoid leaking from previous tests
      mockFs.access.mockReset();
      mockFs.access
        .mockRejectedValueOnce(new Error('no file')) // pytest.ini
        .mockResolvedValueOnce(undefined); // go.mod

      const mockRunTests = jest.fn().mockResolvedValue({
        passed: true, passedTests: 5, failedTests: 0, totalTests: 5, duration: 500, failures: [],
      });
      (MockPassesGate as any).mockImplementation(() => ({ runTests: mockRunTests }));

      await runPassesGate({});
      expect(MockPassesGate).toHaveBeenCalledWith(expect.objectContaining({ testCommand: 'go test ./...' }));
    });

    it('应该检测 test:ci 脚本', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify({
        scripts: { 'test:ci': 'jest --ci' },
      }));

      const mockRunTests = jest.fn().mockResolvedValue({
        passed: true, passedTests: 5, failedTests: 0, totalTests: 5, duration: 500, failures: [],
      });
      (MockPassesGate as any).mockImplementation(() => ({ runTests: mockRunTests }));

      await runPassesGate({});
      expect(MockPassesGate).toHaveBeenCalledWith(expect.objectContaining({ testCommand: 'npm run test:ci' }));
    });

    it('应该跳过默认 echo 测试脚本', async () => {
      mockFs.readFile.mockReset();
      mockFs.readFile.mockResolvedValue(JSON.stringify({
        scripts: { test: 'echo "Error: no test specified"' },
      }));
      mockFs.access.mockReset();
      mockFs.access.mockRejectedValue(new Error('no file'));

      await runPassesGate({});
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('未检测到测试命令'));
    });
  });
});