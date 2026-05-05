/**
 * check 命令测试
 */

import { check, listLaws } from '../check';
import * as fs from 'fs';
import { constraintChecker } from '../../../core/constraints/checker';
import { ProjectConfigLoader } from '../../../core/project-config-loader';
import { IRON_LAWS, GUIDELINES, TIPS } from '../../../core/constraints/definitions';
import { execAsync } from '../../../utils/exec';

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

// Mock execAsync
jest.mock('../../../utils/exec', () => ({
  execAsync: jest.fn(),
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
const mockExecAsync = execAsync as jest.MockedFunction<typeof execAsync>;

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
        ironLaws: [{ id: 'test', level: 'iron_law', satisfied: true, checkedAt: new Date(), constraint: { id: 'test', rule: 'test', message: 'test', level: 'iron_law', trigger: 'code_implementation', enforcement: 'checkpoint-required' } }],
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
        ironLaws: [{ id: 'no_bypass_checkpoint', level: 'iron_law', satisfied: false, checkedAt: new Date(), constraint: { id: 'no_bypass_checkpoint', rule: 'test', message: 'test', level: 'iron_law', trigger: 'code_implementation', enforcement: 'checkpoint-required' } }],
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
        guidelines: [{ id: 'test_guideline', level: 'guideline', satisfied: false, checkedAt: new Date(), constraint: { id: 'test_guideline', rule: 'test', message: 'test', level: 'guideline', trigger: 'code_implementation', enforcement: 'warning' } }],
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
        mergeConstraints: jest.fn().mockReturnValue({ custom: [{ id: 'custom', rule: 'test', message: 'test', level: 'iron_law', trigger: 'code_implementation', enforcement: 'checkpoint-required' }], disabled: ['disabled_constraint'] }),
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
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('已禁用约束'));
    });

    it('应该显示提示信息', async () => {
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true,
        ironLaws: [],
        guidelines: [],
        tips: [{ id: 'test_tip', level: 'tip', satisfied: false, checkedAt: new Date(), constraint: { id: 'test_tip', rule: 'test', message: 'test tip', level: 'tip', trigger: 'code_implementation', enforcement: 'info' } }],
        warningCount: 0,
        tipCount: 1,
      });

      await check({ preset: 'default', staged: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('提示'));
    });

    it('应该显示通过的指导原则', async () => {
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true,
        ironLaws: [],
        guidelines: [{ id: 'test_guideline', level: 'guideline', satisfied: true, checkedAt: new Date(), constraint: { id: 'test_guideline', rule: 'test', message: 'test', level: 'guideline', trigger: 'code_implementation', enforcement: 'warning' } }],
        tips: [],
        warningCount: 0,
        tipCount: 0,
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
        tips: [],
        warningCount: 0,
        tipCount: 0,
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
        tips: [],
        warningCount: 0,
        tipCount: 0,
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
        tips: [],
        warningCount: 0,
        tipCount: 0,
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
        tips: [],
        warningCount: 0,
        tipCount: 0,
      });

      await check({ preset: 'default', staged: false });
      // 不应显示变更文件数量
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('变更文件'));
    });

    it('应该检测 module_modification 触发条件（.ts 文件）', async () => {
      mockExecAsync.mockResolvedValue({ stdout: 'src/foo.ts\nsrc/bar.tsx\n', stderr: '' });
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true, ironLaws: [], guidelines: [], tips: [], warningCount: 0, tipCount: 0,
      });

      await check({ preset: 'default', staged: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('module_modification'));
    });

    it('应该检测 module_modification 触发条件（.js 文件）', async () => {
      mockExecAsync.mockResolvedValue({ stdout: 'src/foo.js\nsrc/bar.jsx\n', stderr: '' });
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true, ironLaws: [], guidelines: [], tips: [], warningCount: 0, tipCount: 0,
      });

      await check({ preset: 'default', staged: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('module_modification'));
    });

    it('应该检测 file_modification 触发条件（非 src/ 目录）', async () => {
      mockExecAsync.mockResolvedValue({ stdout: 'docs/bar.md\n', stderr: '' });
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true, ironLaws: [], guidelines: [], tips: [], warningCount: 0, tipCount: 0,
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
        tips: [],
        warningCount: 0,
        tipCount: 0,
      });

      await check({ preset: 'default', staged: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('module_modification'));
    });

    it('应该使用指定的触发条件', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true,
        ironLaws: [],
        guidelines: [],
        tips: [],
        warningCount: 0,
        tipCount: 0,
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
            id: 'no_bypass_checkpoint',
            rule: 'NO BYPASSING CHECKPOINTS',
            message: '禁止跳过检查点验证',
            level: 'iron_law',
            trigger: 'code_implementation',
            enforcement: 'checkpoint-required',
          },
        }],
        guidelines: [],
        tips: [],
        warningCount: 0,
        tipCount: 0,
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
            id: 'prefer_composition',
            rule: 'PREFER COMPOSITION OVER INHERITANCE',
            message: '优先使用组合而非继承',
            level: 'guideline',
            trigger: 'code_implementation',
            enforcement: 'warning',
          },
        }],
        tips: [],
        warningCount: 1,
        tipCount: 0,
      });

      await check({ preset: 'default', staged: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('prefer_composition'));
    });

    it('应该显示提示的约束详情', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true,
        ironLaws: [],
        guidelines: [],
        tips: [{
          id: 'consider_reuse',
          level: 'tip',
          satisfied: false,
          checkedAt: new Date(),
          constraint: {
            id: 'consider_reuse',
            rule: 'CONSIDER REUSE',
            message: '考虑复用',
            level: 'tip',
            trigger: 'code_implementation',
            enforcement: 'info',
          },
        }],
        warningCount: 0,
        tipCount: 1,
      });

      await check({ preset: 'default', staged: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('consider_reuse'));
    });
  });

  describe('getSmartHint (通过 check 间接测试)', () => {
    beforeEach(() => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
      mockChecker.checkConstraints.mockResolvedValue({
        passed: true,
        ironLaws: [],
        guidelines: [],
        tips: [],
        warningCount: 0,
        tipCount: 0,
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
        if (p.includes('execution.log')) return true;
        if (p.includes('.state.json')) return false;
        return false;
      });
      mockFs.readFileSync.mockReturnValue(traces);

      await check({ preset: 'default', staged: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('记录已足够'));
    });

    it('应该在 trace 数达到 100 且无诊断历史时提示运行 flow', async () => {
      const traces = Array(100).fill('{"result":"pass"}').join('\n');
      mockFs.existsSync.mockImplementation((p: any) => {
        if (p.includes('execution.log')) return true;
        if (p.includes('.state.json')) return false;
        return false;
      });
      mockFs.readFileSync.mockReturnValue(traces);

      await check({ preset: 'default', staged: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('建议运行 harness flow'));
    });

    it('应该在绕过率高时提示查看详情', async () => {
      // 20 条记录，15 条 bypassed (75% > 30%)
      const traces = [
        ...Array(5).fill('{"result":"pass"}'),
        ...Array(15).fill('{"result":"bypassed"}'),
      ].join('\n');
      mockFs.existsSync.mockImplementation((p: any) => {
        if (p.includes('execution.log')) return true;
        if (p.includes('.state.json')) return false;
        return false;
      });
      mockFs.readFileSync.mockReturnValue(traces);

      await check({ preset: 'default', staged: false });
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('异常趋势'));
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
        if (p.includes('execution.log')) return true;
        if (p.includes('.state.json')) return false;
        return false;
      });
      mockFs.readFileSync.mockReturnValue(traces);

      await check({ preset: 'default', staged: false });
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).not.toContain('────────────────');
    });

    it('应该在绕过率低于 30% 时不提示', async () => {
      // 20 条记录，2 条 bypassed (10% < 30%)
      const traces = [
        ...Array(18).fill('{"result":"pass"}'),
        ...Array(2).fill('{"result":"bypassed"}'),
      ].join('\n');
      mockFs.existsSync.mockImplementation((p: any) => {
        if (p.includes('execution.log')) return true;
        if (p.includes('.state.json')) return false;
        return false;
      });
      mockFs.readFileSync.mockReturnValue(traces);

      await check({ preset: 'default', staged: false });
      const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).not.toContain('异常趋势');
    });

    it('应该处理无效 JSON trace 行', async () => {
      // 20 条记录，部分无效 JSON，部分 bypassed
      const traces = [
        ...Array(5).fill('invalid json'),
        ...Array(5).fill('{"result":"pass"}'),
        ...Array(10).fill('{"result":"bypassed"}'),
      ].join('\n');
      mockFs.existsSync.mockImplementation((p: any) => {
        if (p.includes('execution.log')) return true;
        if (p.includes('.state.json')) return false;
        return false;
      });
      mockFs.readFileSync.mockReturnValue(traces);

      await check({ preset: 'default', staged: false });
      // 15 条有效，10 条 bypassed，bypassRate = 10/20 = 0.5 > 0.3
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('异常趋势'));
    });

    it('应该保存状态文件当有提示时', async () => {
      const traces = Array(50).fill('{"result":"pass"}').join('\n');
      mockFs.existsSync.mockImplementation((p: any) => {
        if (p.includes('execution.log')) return true;
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
