/**
 * acceptance 命令测试
 */

import { acceptance, listAcceptanceCriteria } from '../acceptance';
import * as fs from 'fs/promises';
import { SpecAcceptanceGate } from '../../../gates/acceptance';

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  access: jest.fn(),
}));

jest.mock('../../../gates/acceptance', () => ({
  SpecAcceptanceGate: jest.fn().mockImplementation(() => ({
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
  cyan: jest.fn((s: string) => s),
}));

const mockFs = fs as jest.Mocked<typeof fs>;
const MockGate = SpecAcceptanceGate as jest.MockedClass<typeof SpecAcceptanceGate>;
const yaml = require('js-yaml');

describe('acceptance command', () => {
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

  describe('acceptance', () => {
    it('should print success when check passes', async () => {
      const mockCheck = jest.fn().mockResolvedValue({
        passed: true,
        message: 'ok',
        details: { checkedCriteria: 5, totalCriteria: 5 },
      });
      MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

      await acceptance({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('验收标准检查通过'));
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('should print failure and exit 1 when check fails', async () => {
      const mockCheck = jest.fn().mockResolvedValue({
        passed: false,
        message: 'criteria not met',
        details: { uncheckedCriteria: ['criteria-1', 'criteria-2'] },
      });
      MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

      await acceptance({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('验收标准检查失败'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle errors and exit 1', async () => {
      const mockCheck = jest.fn().mockRejectedValue(new Error('gate error'));
      MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

      await acceptance({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('验收标准检查出错'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should use cwd as default projectPath', async () => {
      const mockCheck = jest.fn().mockResolvedValue({ passed: true, message: 'ok' });
      MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

      await acceptance({});

      expect(mockCheck).toHaveBeenCalledWith(
        expect.objectContaining({ projectPath: process.cwd() }),
      );
    });

    it('should pass taskId to gate', async () => {
      const mockCheck = jest.fn().mockResolvedValue({ passed: true, message: 'ok' });
      MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

      await acceptance({ taskId: 'TASK-001' });

      expect(mockCheck).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'TASK-001' }),
      );
    });

    it('should set e2eTestCommand when runE2e is true', async () => {
      const mockCheck = jest.fn().mockResolvedValue({ passed: true, message: 'ok' });
      MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

      await acceptance({ runE2e: true });

      expect(MockGate).toHaveBeenCalledWith(
        expect.objectContaining({ e2eTestCommand: 'npx playwright test' }),
      );
    });

    it('should not set e2eTestCommand when runE2e is false', async () => {
      const mockCheck = jest.fn().mockResolvedValue({ passed: true, message: 'ok' });
      MockGate.mockImplementation(() => ({ check: mockCheck }) as any);

      await acceptance({});

      expect(MockGate).toHaveBeenCalledWith(
        expect.objectContaining({ e2eTestCommand: undefined }),
      );
    });
  });

  describe('listAcceptanceCriteria', () => {
    it('should list tasks and their criteria', async () => {
      mockFs.readFile.mockResolvedValue('yaml-content');
      yaml.load.mockReturnValue({
        'task-1': { acceptanceCriteria: ['Criteria 1', 'Criteria 2'] },
        'task-2': { acceptanceCriteria: ['Criteria A'] },
      });

      await listAcceptanceCriteria({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('task-1'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Criteria 1'));
    });

    it('should handle task with no criteria', async () => {
      mockFs.readFile.mockResolvedValue('yaml-content');
      yaml.load.mockReturnValue({
        'task-1': {},
      });

      await listAcceptanceCriteria({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('无验收标准'));
    });

    it('should handle empty tasks object', async () => {
      mockFs.readFile.mockResolvedValue('yaml-content');
      yaml.load.mockReturnValue(null);

      await listAcceptanceCriteria({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('未找到任务定义'));
    });

    it('should handle file read error', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));

      await listAcceptanceCriteria({});

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('读取 tasks.yml 失败'));
    });
  });
});
