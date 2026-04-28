/**
 * check 命令测试
 */

import { check, listLaws } from '../check';
import * as fs from 'fs';
import { constraintChecker } from '../../../core/constraints/checker';
import { ProjectConfigLoader } from '../../../core/project-config-loader';
import { IRON_LAWS, GUIDELINES, TIPS } from '../../../core/constraints/definitions';

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

// Mock constraintChecker
jest.mock('../../../core/constraints/checker', () => ({
  constraintChecker: {
    setCustomConfig: jest.fn(),
    checkConstraints: jest.fn(),
  },
}));

// Mock ProjectConfigLoader
jest.mock('../../../core/project-config-loader', () => ({
  ProjectConfigLoader: jest.fn().mockImplementation(() => ({
    load: jest.fn(),
    hasCustomConfig: jest.fn().mockReturnValue(false),
    mergeConstraints: jest.fn().mockReturnValue({ custom: [], disabled: [] }),
  })),
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
const mockChecker = constraintChecker as jest.Mocked<typeof constraintChecker>;
const MockProjectConfigLoader = ProjectConfigLoader as jest.MockedClass<typeof ProjectConfigLoader>;

describe('check command', () => {
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

  describe('check', () => {
    it('应该通过所有约束检查', async () => {
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true,
        ironLaws: [{ id: 'test', level: 'iron_law', satisfied: true, checkedAt: new Date(), constraint: { id: 'test', rule: 'test', message: 'test', level: 'iron_law', trigger: 'step_execution', enforcement: 'checkpoint-required' } }],
        guidelines: [],
        tips: [],
        warningCount: 0,
        tipCount: 0,
      });

      await check({ preset: 'default', staged: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('约束检查通过'));
    });

    it('应该显示铁律违规', async () => {
      mockChecker.checkConstraints.mockResolvedValue({
        passed: false,
        ironLaws: [{ id: 'no_bypass_checkpoint', level: 'iron_law', satisfied: false, checkedAt: new Date(), constraint: { id: 'no_bypass_checkpoint', rule: 'test', message: 'test', level: 'iron_law', trigger: 'step_execution', enforcement: 'checkpoint-required' } }],
        guidelines: [],
        tips: [],
        warningCount: 0,
        tipCount: 0,
      });

      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      await check({ preset: 'default', staged: false });
      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });

    it('应该显示指导原则警告', async () => {
      mockChecker.checkConstraints.mockResolvedValue({
        passed: false,
        ironLaws: [],
        guidelines: [{ id: 'test_guideline', level: 'guideline', satisfied: false, checkedAt: new Date(), constraint: { id: 'test_guideline', rule: 'test', message: 'test', level: 'guideline', trigger: 'step_execution', enforcement: 'warning' } }],
        tips: [],
        warningCount: 1,
        tipCount: 0,
      });

      await check({ preset: 'default', staged: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('指导原则警告'));
    });

    it('应该加载自定义约束', async () => {
      const mockLoader = {
        load: jest.fn(),
        hasCustomConfig: jest.fn().mockReturnValue(true),
        mergeConstraints: jest.fn().mockReturnValue({ custom: [{ id: 'custom', rule: 'test', message: 'test', level: 'iron_law', trigger: 'step_execution', enforcement: 'checkpoint-required' }], disabled: [] }),
      };
      (MockProjectConfigLoader as any).mockImplementation(() => mockLoader);

      mockChecker.checkConstraints.mockResolvedValue({
        passed: true,
        ironLaws: [],
        guidelines: [],
        tips: [],
        warningCount: 0,
        tipCount: 0,
      });

      await check({ preset: 'default', staged: false, projectPath: '/project' });
      expect(mockChecker.setCustomConfig).toHaveBeenCalled();
    });
  });

  describe('listLaws', () => {
    it('应该列出所有约束', () => {
      listLaws();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('所有约束'));
    });

    it('应该列出铁律', () => {
      listLaws();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('铁律'));
    });

    it('应该列出指导原则', () => {
      listLaws();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('指导原则'));
    });

    it('应该列出提示', () => {
      listLaws();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('提示'));
    });
  });
});
