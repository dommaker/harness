/**
 * check 命令测试
 */

import { check, listLaws } from '../check';
import * as fs from 'fs';
import { constraintChecker } from '../../../core/constraints/checker';
import { getMergedConstraintsConfig } from '../../../core/effective-constraints';
import { execAsync } from '../../../utils/exec';

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  readdirSync: jest.fn(),
}));

// Mock execAsync
jest.mock('../../../utils/exec', () => ({
  execAsync: jest.fn(),
}));

// Mock child_process.execSync (used by isNewDirectory + getChangedFiles in check.ts)
jest.mock('child_process', () => ({
  exec: jest.fn(),
  execSync: jest.fn((cmd: string) => {
    if (cmd.includes('git ls-tree')) {
      // 工单 18 后为批量命令 `git ls-tree -r --name-only HEAD`，返回文件列表
      return Buffer.from('src/foo.ts\nsrc/module.ts\nsrc/__tests__/module.test.ts\n');
    }
    if (cmd.includes('git diff')) {
      return Buffer.from('src/test.ts\nsrc/legacy.js');
    }
    return Buffer.from('');
  }),
}));

// Mock constraintChecker
jest.mock('../../../core/constraints/checker', () => ({
  constraintChecker: {
    setTraceRecorder: jest.fn(),
    checkConstraints: jest.fn(),
  },
}));

// Mock effective-constraints（ADR-0001：check 经 getMergedConstraintsConfig 走生效集链路）
jest.mock('../../../core/effective-constraints', () => ({
  getMergedConstraintsConfig: jest.fn().mockReturnValue({
    ironLaws: {},
    guidelines: {},
    prompts: {},
    custom: [],
    disabled: [],
    unknownIds: [],
  }),
}));

// Mock chalk
jest.mock('chalk', () => ({
  blue: jest.fn((str: string) => str),
  yellow: jest.fn((str: string) => str),
  green: jest.fn((str: string) => str),
  gray: jest.fn((str: string) => str),
  red: jest.fn((str: string) => str),
}));

const mockFs = fs as jest.Mocked<typeof fs> & { readdirSync: jest.Mock };
const mockChecker = constraintChecker as jest.Mocked<typeof constraintChecker>;
const mockGetMergedConfig = getMergedConstraintsConfig as jest.MockedFunction<typeof getMergedConstraintsConfig>;
const mockExecAsync = execAsync as jest.MockedFunction<typeof execAsync>;

describe('check command', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks 不清实现，显式恢复默认 merged config，避免用例间泄漏
    mockGetMergedConfig.mockReturnValue({
      ironLaws: {},
      guidelines: {},
      prompts: {},
      custom: [],
      disabled: [],
      unknownIds: [],
    });
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
        ironLaws: [{ id: 'test', level: 'iron_law', satisfied: true, checkedAt: new Date(), constraint: { kind: 'check' as const, id: 'test', rule: 'test', message: 'test', level: 'iron_law', trigger: 'code_implementation', enforcement: 'checkpoint-required' } }],
        guidelines: [],
        warningCount: 0,
      });

      await check({ preset: 'default', staged: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('约束检查通过'));
    });

    it('应该显示铁律违规', async () => {
      mockChecker.checkConstraints.mockResolvedValue({
        passed: false,
        ironLaws: [{ id: 'no_bypass_checkpoint', level: 'iron_law', satisfied: false, checkedAt: new Date(), constraint: { kind: 'check' as const, id: 'no_bypass_checkpoint', rule: 'test', message: 'test', level: 'iron_law', trigger: 'code_implementation', enforcement: 'checkpoint-required' } }],
        guidelines: [],
        warningCount: 0,
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
        guidelines: [{ id: 'test_guideline', level: 'guideline', satisfied: false, checkedAt: new Date(), constraint: { kind: 'check' as const, id: 'test_guideline', rule: 'test', message: 'test', level: 'guideline', trigger: 'code_implementation', enforcement: 'warning' } }],
        warningCount: 1,
      });

      await check({ preset: 'default', staged: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('指导原则警告'));
    });

    it('应该加载自定义约束', async () => {
      mockGetMergedConfig.mockReturnValue({
        ironLaws: {},
        guidelines: {},
        prompts: {},
        custom: ['custom'],
        disabled: ['disabled_constraint'],
        unknownIds: [],
      });

      mockChecker.checkConstraints.mockResolvedValue({
        passed: true,
        ironLaws: [],
        guidelines: [],
        warningCount: 0,
      });

      await check({ preset: 'default', staged: false, projectPath: '/project' });
      expect(mockChecker.checkConstraints).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ disabled: ['disabled_constraint'] })
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('已禁用约束'));
    });

    it('应该显示通过的指导原则', async () => {
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true,
        ironLaws: [],
        guidelines: [{ id: 'test_guideline', level: 'guideline', satisfied: true, checkedAt: new Date(), constraint: { kind: 'check' as const, id: 'test_guideline', rule: 'test', message: 'test', level: 'guideline', trigger: 'code_implementation', enforcement: 'warning' } }],
        warningCount: 0,
      });

      await check({ preset: 'default', staged: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('指导原则'));
    });

    it('应该显示变更文件数量', async () => {
      // Mock getChangedFiles 返回变更文件
      mockExecAsync.mockResolvedValue({ stdout: 'src/foo.ts\nsrc/bar.ts\n', stderr: '' });
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true,
        ironLaws: [],
        guidelines: [],
        warningCount: 0,
      });

      await check({ preset: 'default', staged: true });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('变更文件: 2 个'));
    });

    it('应该使用 unstaged diff 当 staged 为 false', async () => {
      mockExecAsync.mockResolvedValue({ stdout: 'file.ts\n', stderr: '' });
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true,
        ironLaws: [],
        guidelines: [],
        warningCount: 0,
      });

      await check({ preset: 'default', staged: false });
      expect(mockExecAsync).toHaveBeenCalledWith('git diff --name-only');
    });

    it('应该使用 staged diff 当 staged 为 true', async () => {
      mockExecAsync.mockResolvedValue({ stdout: 'file.ts\n', stderr: '' });
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true,
        ironLaws: [],
        guidelines: [],
        warningCount: 0,
      });

      await check({ preset: 'default', staged: true });
      expect(mockExecAsync).toHaveBeenCalledWith('git diff --cached --name-only');
    });

    it('应该在 git 失败时返回空文件列表', async () => {
      mockExecAsync.mockRejectedValue(new Error('not a git repo'));
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true,
        ironLaws: [],
        guidelines: [],
        warningCount: 0,
      });

      await check({ preset: 'default', staged: false });
      // 不应显示变更文件数量
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('变更文件'));
    });

    it('应该检测 module_modification 触发条件（.ts 文件）', async () => {
      mockExecAsync.mockResolvedValue({ stdout: 'src/foo.ts\nsrc/bar.tsx\n', stderr: '' });
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true, ironLaws: [], guidelines: [], warningCount: 0,
      });

      // Mock filesystem so detectSourceRoots finds src/ as a source root
      const mockProjectPath = '/mock-project';
      mockFs.existsSync.mockImplementation((p: any) => {
        if (p === `${mockProjectPath}/src`) return true;
        return false;
      });
      mockFs.readdirSync.mockImplementation((dir: any) => {
        if (dir === `${mockProjectPath}/src`) {
          return [{ name: 'foo.ts', isFile: () => true, isDirectory: () => false }] as any;
        }
        return [];
      });

      await check({ preset: 'default', staged: false, projectPath: mockProjectPath });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('module_modification'));
    });

    it('应该检测 module_modification 触发条件（.js 文件）', async () => {
      mockExecAsync.mockResolvedValue({ stdout: 'src/foo.js\nsrc/bar.jsx\n', stderr: '' });
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true, ironLaws: [], guidelines: [], warningCount: 0,
      });

      // Mock filesystem so detectSourceRoots finds src/ as a source root
      const mockProjectPath = '/mock-project';
      mockFs.existsSync.mockImplementation((p: any) => {
        if (p === `${mockProjectPath}/src`) return true;
        return false;
      });
      mockFs.readdirSync.mockImplementation((dir: any) => {
        if (dir === `${mockProjectPath}/src`) {
          return [{ name: 'foo.ts', isFile: () => true, isDirectory: () => false }] as any;
        }
        return [];
      });

      await check({ preset: 'default', staged: false, projectPath: mockProjectPath });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('module_modification'));
    });

    it('应该检测 file_modification 触发条件（非 src/ 目录）', async () => {
      mockExecAsync.mockResolvedValue({ stdout: 'docs/bar.md\n', stderr: '' });
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true, ironLaws: [], guidelines: [], warningCount: 0,
      });

      await check({ preset: 'default', staged: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('file_modification'));
    });

    it('应该检测 module_modification 触发条件', async () => {
      // src 目录下有非测试文件变更
      mockExecAsync.mockResolvedValue({ stdout: 'src/module.ts\nsrc/__tests__/module.test.ts\n', stderr: '' });
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true,
        ironLaws: [],
        guidelines: [],
        warningCount: 0,
      });

      // Mock filesystem so detectSourceRoots finds src/ as a source root
      const mockProjectPath = '/mock-project';
      mockFs.existsSync.mockImplementation((p: any) => {
        if (p === `${mockProjectPath}/src`) return true;
        return false;
      });
      mockFs.readdirSync.mockImplementation((dir: any) => {
        if (dir === `${mockProjectPath}/src`) {
          return [{ name: 'module.ts', isFile: () => true, isDirectory: () => false }] as any;
        }
        return [];
      });

      await check({ preset: 'default', staged: false, projectPath: mockProjectPath });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('module_modification'));
    });

    it('应该使用指定的触发条件', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true,
        ironLaws: [],
        guidelines: [],
        warningCount: 0,
      });

      await check({ preset: 'default', staged: false, trigger: 'code_implementation' });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('code_implementation'));
    });

    it('应该显示铁律违规的约束详情', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      mockChecker.checkConstraints.mockResolvedValue({
        passed: false,
        ironLaws: [{
          id: 'no_bypass_checkpoint',
          level: 'iron_law',
          satisfied: false,
          checkedAt: new Date(),
          constraint: {
            kind: 'check' as const,
            id: 'no_bypass_checkpoint',
            rule: 'NO BYPASSING CHECKPOINTS',
            message: '禁止跳过检查点验证',
            level: 'iron_law',
            trigger: 'code_implementation',
            enforcement: 'checkpoint-required',
          },
        }],
        guidelines: [],
        warningCount: 0,
      });

      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      await check({ preset: 'default', staged: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('no_bypass_checkpoint'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('NO BYPASSING CHECKPOINTS'));
      mockExit.mockRestore();
    });

    it('应该显示指导原则的约束详情', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true,
        ironLaws: [],
        guidelines: [{
          id: 'prefer_composition',
          level: 'guideline',
          satisfied: false,
          checkedAt: new Date(),
          constraint: {
            kind: 'check' as const,
            id: 'prefer_composition',
            rule: 'PREFER COMPOSITION OVER INHERITANCE',
            message: '优先使用组合而非继承',
            level: 'guideline',
            trigger: 'code_implementation',
            enforcement: 'warning',
          },
        }],
        warningCount: 1,
      });

      await check({ preset: 'default', staged: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('prefer_composition'));
    });

  });

  describe('getSmartHint (通过 check 间接测试)', () => {
    beforeEach(() => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true,
        ironLaws: [],
        guidelines: [],
        warningCount: 0,
      });
    });

    it('应该在 trace 不存在时无提示', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await check({ preset: 'default', staged: false });
      // 不应有提示分隔线
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).not.toContain('────────────────');
    });

    it('应该在 trace 数达到 50 时提示查看统计', async () => {
      const traces = Array(50).fill('{"result":"pass"}').join('\n');
      mockFs.existsSync.mockImplementation((p: any) => {
        if (p.includes('traces.log')) return true;
        if (p.includes('.state.json')) return false;
        return false;
      });
      mockFs.readFileSync.mockReturnValue(traces);

      await check({ preset: 'default', staged: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('记录已足够'));
    });

    it('应该不重复显示已显示的提示', async () => {
      const traces = Array(50).fill('{"result":"pass"}').join('\n');
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation((p: any) => {
        if (p.includes('.state.json')) {
          return JSON.stringify({ shownHints: ['trace_50'] });
        }
        return traces;
      });

      await check({ preset: 'default', staged: false });
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).not.toContain('记录已足够');
    });

    it('应该在 trace 数少于 50 时不提示', async () => {
      const traces = Array(10).fill('{"result":"pass"}').join('\n');
      mockFs.existsSync.mockImplementation((p: any) => {
        if (p.includes('traces.log')) return true;
        if (p.includes('.state.json')) return false;
        return false;
      });
      mockFs.readFileSync.mockReturnValue(traces);

      await check({ preset: 'default', staged: false });
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).not.toContain('────────────────');
    });

    it('应该保存状态文件当有提示时', async () => {
      const traces = Array(50).fill('{"result":"pass"}').join('\n');
      mockFs.existsSync.mockImplementation((p: any) => {
        if (p.includes('traces.log')) return true;
        if (p.includes('.state.json')) return false;
        return false;
      });
      mockFs.readFileSync.mockReturnValue(traces);

      await check({ preset: 'default', staged: false });
      expect(mockFs.writeFileSync).toHaveBeenCalled();
      expect(mockFs.mkdirSync).toHaveBeenCalled();
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
